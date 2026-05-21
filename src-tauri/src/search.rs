use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexWriter, ReloadPolicy};

static SEARCH: std::sync::LazyLock<Mutex<Option<SearchEngine>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

struct SearchEngine {
    index: Index,
    path_field: Field,
    name_field: Field,
    content_field: Field,
}

fn get_search_dir() -> String {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| Path::new("/tmp").to_path_buf())
        .join("tash");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("search_index").to_string_lossy().to_string()
}

fn init_engine() -> Result<SearchEngine, String> {
    let mut schema_builder = Schema::builder();
    let path_field = schema_builder.add_text_field("path", STRING | STORED);
    let name_field = schema_builder.add_text_field("name", TEXT | STORED);
    let content_field = schema_builder.add_text_field("content", TEXT);
    let schema = schema_builder.build();
    let dir_path = get_search_dir();
    std::fs::create_dir_all(&dir_path).ok();
    let index = if Path::new(&dir_path).join("meta.json").exists() {
        Index::open_in_dir(&dir_path).map_err(|e| format!("Cannot open index: {}", e))?
    } else {
        Index::create_in_dir(&dir_path, schema)
            .map_err(|e| format!("Cannot create index: {}", e))?
    };
    Ok(SearchEngine {
        index,
        path_field,
        name_field,
        content_field,
    })
}

fn get_engine() -> Result<std::sync::MutexGuard<'static, Option<SearchEngine>>, String> {
    let mut guard = SEARCH
        .lock()
        .map_err(|e| format!("Search lock error: {}", e))?;
    if guard.is_none() {
        *guard = Some(init_engine()?);
    }
    Ok(guard)
}

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub score: f32,
}

#[allow(dead_code)]
pub fn index_file(path: &str) -> Result<(), String> {
    let mut guard = get_engine()?;
    let engine = guard.as_mut().unwrap();
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut writer: IndexWriter = engine
        .index
        .writer(50_000_000)
        .map_err(|e| format!("Cannot create writer: {}", e))?;

    writer
        .add_document(doc!(
            engine.path_field => path,
            engine.name_field => name,
            engine.content_field => "",
        ))
        .map_err(|e| format!("Cannot add document: {}", e))?;

    writer
        .commit()
        .map_err(|e| format!("Cannot commit: {}", e))?;

    Ok(())
}

pub fn index_directory(path: &str) -> Result<usize, String> {
    let mut guard = get_engine()?;
    let engine = guard.as_mut().unwrap();
    let mut count = 0;
    let mut writer: IndexWriter = engine
        .index
        .writer(50_000_000)
        .map_err(|e| format!("Cannot create writer: {}", e))?;

    for entry in walkdir::WalkDir::new(path)
        .max_depth(20)
        .follow_links(false)
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path().to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        writer
            .add_document(doc!(
                engine.path_field => path.as_str(),
                engine.name_field => name.as_str(),
                engine.content_field => "",
            ))
            .map_err(|e| format!("Cannot add document: {}", e))?;
        count += 1;
    }
    writer
        .commit()
        .map_err(|e| format!("Cannot commit: {}", e))?;
    Ok(count)
}

pub fn search(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    let mut guard = get_engine()?;
    let engine = guard.as_mut().unwrap();
    let reader = engine
        .index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
        .map_err(|e| format!("Cannot create reader: {}", e))?;

    let searcher = reader.searcher();
    let query_parser =
        QueryParser::for_index(&engine.index, vec![engine.name_field, engine.content_field]);
    let parsed_query = query_parser
        .parse_query(query)
        .map_err(|e| format!("Query parse error: {}", e))?;

    let top_docs = searcher
        .search(&parsed_query, &TopDocs::with_limit(limit))
        .map_err(|e| format!("Search error: {}", e))?;

    let mut results = Vec::new();
    for (score, doc_address) in top_docs {
        let doc = searcher
            .doc::<tantivy::TantivyDocument>(doc_address)
            .map_err(|e| format!("Doc error: {}", e))?;
        let path = doc
            .get_first(engine.path_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = doc
            .get_first(engine.name_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        results.push(SearchResult { path, name, score });
    }
    Ok(results)
}
