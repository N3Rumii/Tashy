use rusqlite::{params, Connection, Result as SqlResult};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

static DB: LazyLock<Mutex<Connection>> = LazyLock::new(|| {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path).expect("Failed to open database");
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-64000; PRAGMA mmap_size=268435456; PRAGMA temp_store=MEMORY;"
    ).expect("Failed to set pragmas");
    init_schema(&conn).expect("Failed to initialize schema");
    Mutex::new(conn)
});

fn get_db_path() -> String {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| Path::new("/tmp").to_path_buf())
        .join("tash");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("tags.db").to_string_lossy().to_string()
}

fn init_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            is_dir INTEGER NOT NULL DEFAULT 0,
            indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL DEFAULT '#228be6',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS file_tags (
            file_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (file_id, tag_id),
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id ON file_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_file_tags_file_id ON file_tags(file_id);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
        CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
        ",
    )?;
    Ok(())
}

// --- Public types ---

#[derive(Debug, Clone, Serialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct FileRecord {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub indexed_at: String,
}

#[derive(Debug, Serialize)]
pub struct FileWithTags {
    pub file: FileRecord,
    pub tags: Vec<Tag>,
}

// --- DB operations ---

pub fn index_directory(dir_path: &str) -> Result<usize, String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut count = 0;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Transaction error: {}", e))?;
    match std::fs::read_dir(dir_path) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path().to_string_lossy().to_string();
                let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
                let result: SqlResult<usize> = tx.execute(
                    "INSERT OR IGNORE INTO files (path, name, is_dir) VALUES (?1, ?2, ?3)",
                    params![path, name, is_dir as i32],
                );
                if let Ok(rows) = result {
                    if rows > 0 {
                        count += 1;
                    }
                }
                if is_dir {
                    if let Ok(sub) = index_directory_recursive(&tx, &entry.path()) {
                        count += sub;
                    }
                }
            }
        }
        Err(e) => return Err(format!("Cannot read directory: {}", e)),
    }
    tx.commit().map_err(|e| format!("Commit error: {}", e))?;
    Ok(count)
}

fn index_directory_recursive(tx: &rusqlite::Transaction, dir_path: &Path) -> Result<usize, String> {
    let mut count = 0;
    match std::fs::read_dir(dir_path) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path().to_string_lossy().to_string();
                let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
                let result = tx.execute(
                    "INSERT OR IGNORE INTO files (path, name, is_dir) VALUES (?1, ?2, ?3)",
                    params![path, name, is_dir as i32],
                );
                if let Ok(rows) = result {
                    if rows > 0 {
                        count += 1;
                    }
                }
                if is_dir {
                    if let Ok(sub) = index_directory_recursive(tx, &entry.path()) {
                        count += sub;
                    }
                }
            }
        }
        Err(e) => return Err(format!("Cannot read directory: {}", e)),
    }
    Ok(count)
}

pub fn create_tag(name: &str, color: &str) -> Result<Tag, String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    conn.execute(
        "INSERT INTO tags (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| format!("Cannot create tag: {}", e))?;
    let id = conn.last_insert_rowid();
    Ok(Tag {
        id,
        name: name.to_string(),
        color: color.to_string(),
        created_at: String::new(),
    })
}

pub fn get_all_tags() -> Result<Vec<Tag>, String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at FROM tags ORDER BY name")
        .map_err(|e| format!("Query error: {}", e))?;
    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

pub fn update_tag(id: i64, name: &str, color: &str) -> Result<(), String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let rows = conn
        .execute(
            "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
            params![name, color, id],
        )
        .map_err(|e| format!("Cannot update tag: {}", e))?;
    if rows == 0 {
        return Err(format!("Tag with id {} not found", id));
    }
    Ok(())
}

pub fn delete_tag(id: i64) -> Result<(), String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(|e| format!("Cannot delete tag: {}", e))?;
    Ok(())
}

pub fn add_tag_to_file(file_path: &str, tag_id: i64) -> Result<(), String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let file_id: i64 = match conn.query_row(
        "SELECT id FROM files WHERE path = ?1",
        params![file_path],
        |row| row.get(0),
    ) {
        Ok(id) => id,
        Err(_) => {
            let name = Path::new(file_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let is_dir = Path::new(file_path).is_dir();
            conn.execute(
                "INSERT INTO files (path, name, is_dir) VALUES (?1, ?2, ?3)",
                params![file_path, name, is_dir as i32],
            )
            .map_err(|e| format!("Cannot insert file: {}", e))?;
            conn.last_insert_rowid()
        }
    };
    conn.execute(
        "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
        params![file_id, tag_id],
    )
    .map_err(|e| format!("Cannot add tag: {}", e))?;
    Ok(())
}

pub fn remove_tag_from_file(file_path: &str, tag_id: i64) -> Result<(), String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    conn.execute(
        "DELETE FROM file_tags WHERE file_id = (SELECT id FROM files WHERE path = ?1) AND tag_id = ?2",
        params![file_path, tag_id],
    ).map_err(|e| format!("Cannot remove tag: {}", e))?;
    Ok(())
}

pub fn get_tags_for_file(file_path: &str) -> Result<Vec<Tag>, String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color, t.created_at FROM tags t
         JOIN file_tags ft ON t.id = ft.tag_id JOIN files f ON f.id = ft.file_id
         WHERE f.path = ?1 ORDER BY t.name",
        )
        .map_err(|e| format!("Query error: {}", e))?;
    let tags = stmt
        .query_map(params![file_path], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

pub fn get_tags_for_files(paths: &[String]) -> Result<HashMap<String, Vec<Tag>>, String> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let placeholders: Vec<String> = paths
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT f.path, t.id, t.name, t.color, t.created_at FROM files f
         JOIN file_tags ft ON f.id = ft.file_id JOIN tags t ON t.id = ft.tag_id
         WHERE f.path IN ({}) ORDER BY f.path, t.name",
        placeholders.join(",")
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Query error: {}", e))?;
    let params: Vec<&dyn rusqlite::types::ToSql> = paths
        .iter()
        .map(|p| p as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("Query error: {}", e))?;
    let mut map: HashMap<String, Vec<Tag>> = HashMap::new();
    for path in paths {
        map.entry(path.clone()).or_default();
    }
    for row in rows {
        let (path, id, name, color, created_at) = row.map_err(|e| format!("Row error: {}", e))?;
        map.entry(path).or_default().push(Tag {
            id,
            name,
            color,
            created_at,
        });
    }
    Ok(map)
}

pub fn add_tag_to_folder_recursive(folder_path: &str, tag_id: i64) -> Result<usize, String> {
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut count = 0;
    for entry in walkdir::WalkDir::new(folder_path)
        .max_depth(20)
        .follow_links(false)
    {
        let entry = entry.map_err(|e| format!("Walk error: {}", e))?;
        let path = entry.path().to_string_lossy().to_string();
        let file_id: i64 = match conn.query_row(
            "SELECT id FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ) {
            Ok(id) => id,
            Err(_) => {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().is_dir();
                conn.execute(
                    "INSERT INTO files (path, name, is_dir) VALUES (?1, ?2, ?3)",
                    params![path, name, is_dir as i32],
                )
                .map_err(|e| format!("Insert error: {}", e))?;
                conn.last_insert_rowid()
            }
        };
        let rows = conn
            .execute(
                "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
                params![file_id, tag_id],
            )
            .map_err(|e| format!("Tag insert error: {}", e))?;
        count += rows;
    }
    Ok(count)
}

pub fn get_files_by_tags(
    tag_ids: Vec<i64>,
    max_results: Option<usize>,
) -> Result<Vec<FileWithTags>, String> {
    if tag_ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = DB.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let required = tag_ids.len() as i64;
    let placeholders: Vec<String> = tag_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();

    // Step 1: Index-only scan on file_tags to find files matching ALL tags
    let ids_sql = format!(
        "SELECT file_id FROM file_tags WHERE tag_id IN ({}) GROUP BY file_id HAVING COUNT(*) >= {}",
        placeholders.join(","),
        required
    );
    let mut ids_stmt = conn
        .prepare(&ids_sql)
        .map_err(|e| format!("Query error: {}", e))?;
    let params: Vec<&dyn rusqlite::types::ToSql> = tag_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    let file_ids: Vec<i64> = ids_stmt
        .query_map(params.as_slice(), |row| row.get::<_, i64>(0))
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .take(max_results.unwrap_or(usize::MAX))
        .collect();
    if file_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Load files + tags in a single query (using the same conn, no deadlock)
    let id_placeholders: Vec<String> = file_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT f.id, f.path, f.name, f.is_dir, f.indexed_at,
                t.id as tag_id, t.name, t.color, t.created_at
         FROM files f
         LEFT JOIN file_tags ft ON ft.file_id = f.id
         LEFT JOIN tags t ON t.id = ft.tag_id
         WHERE f.id IN ({}) ORDER BY f.name, t.name",
        id_placeholders.join(",")
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Query error: {}", e))?;
    let file_params: Vec<&dyn rusqlite::types::ToSql> = file_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = stmt
        .query_map(file_params.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut file_map: std::collections::BTreeMap<i64, FileWithTags> =
        std::collections::BTreeMap::new();
    for row in rows {
        let (fid, fpath, fname, fis_dir, findexed, tid, tname, tcolor, tcreated) =
            row.map_err(|e| format!("Row error: {}", e))?;
        let entry = file_map.entry(fid).or_insert_with(|| FileWithTags {
            file: FileRecord {
                id: fid,
                path: fpath,
                name: fname,
                is_dir: fis_dir != 0,
                indexed_at: findexed,
            },
            tags: Vec::new(),
        });
        if let (Some(tid), Some(tname), Some(tcolor), Some(tcreated)) =
            (tid, tname, tcolor, tcreated)
        {
            entry.tags.push(Tag {
                id: tid,
                name: tname,
                color: tcolor,
                created_at: tcreated,
            });
        }
    }
    Ok(file_map.into_values().collect())
}
