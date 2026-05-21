mod db;
mod search;

use md5::Digest;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::Emitter;

static FILE_WATCHER: std::sync::LazyLock<Mutex<Option<RecommendedWatcher>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: String,
    is_executable: bool,
}

#[tauri::command]
fn read_directory(
    dir_path: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    let mut entries = Vec::new();

    match fs::read_dir(path) {
        Ok(read_dir) => {
            for entry in read_dir {
                match entry {
                    Ok(dir_entry) => {
                        // Use file_type() — reads d_type from dirent on Linux, no stat() syscall
                        let is_dir = dir_entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                        let file_name = dir_entry.file_name().to_string_lossy().to_string();
                        let full_path = dir_entry.path().to_string_lossy().to_string();

                        // Only call metadata() for size + permissions (skip if error — default to 0 / not executable)
                        let (size, is_executable) = if is_dir {
                            (0u64, false)
                        } else if let Ok(meta) = dir_entry.metadata() {
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                (meta.len(), meta.permissions().mode() & 0o111 != 0)
                            }
                            #[cfg(not(unix))]
                            {
                                (meta.len(), false)
                            }
                        } else {
                            (0u64, false)
                        };

                        entries.push(FileEntry {
                            name: file_name,
                            path: full_path,
                            is_dir,
                            size,
                            modified: String::new(),
                            is_executable,
                        });
                    }
                    Err(_) => continue,
                }
            }
        }
        Err(e) => {
            return Err(format!("Cannot read directory: {}", e));
        }
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    // Apply pagination
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(usize::MAX);
    if offset > 0 {
        entries.drain(0..offset.min(entries.len()));
    }
    if entries.len() > limit {
        entries.truncate(limit);
    }

    Ok(entries)
}

// ---------------------------------------------------------------------------
// File operation helpers
// ---------------------------------------------------------------------------

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Cannot create target directory: {}", e))?;
    let entries = fs::read_dir(src).map_err(|e| format!("Cannot read source directory: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read directory entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Cannot copy '{}': {}", src_path.display(), e))?;
        }
    }
    Ok(())
}

fn remove_dir_recursive(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        let entries = fs::read_dir(path).map_err(|e| format!("Cannot read directory: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Cannot read entry: {}", e))?;
            remove_dir_recursive(&entry.path())?;
        }
        fs::remove_dir(path)
            .map_err(|e| format!("Cannot remove directory '{}': {}", path.display(), e))?;
    } else {
        fs::remove_file(path)
            .map_err(|e| format!("Cannot remove file '{}': {}", path.display(), e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn copy_file(src: String, dst: String) -> Result<(), String> {
    let src_path = Path::new(&src);
    let dst_path = Path::new(&dst);

    if !src_path.exists() {
        return Err(format!("Source does not exist: {}", src));
    }

    if src_path.is_dir() {
        let target = if dst_path.exists() && dst_path.is_dir() {
            dst_path.join(src_path.file_name().unwrap_or_default())
        } else {
            dst_path.to_path_buf()
        };
        copy_dir_recursive(src_path, &target)
    } else {
        let target = if dst_path.exists() && dst_path.is_dir() {
            dst_path.join(src_path.file_name().unwrap_or_default())
        } else {
            dst_path.to_path_buf()
        };
        fs::copy(src_path, &target)
            .map(|_| ())
            .map_err(|e| format!("Cannot copy file: {}", e))
    }
}

#[tauri::command]
fn move_file(src: String, dst: String) -> Result<(), String> {
    let src_path = Path::new(&src);
    let dst_path = Path::new(&dst);

    if !src_path.exists() {
        return Err(format!("Source does not exist: {}", src));
    }

    fs::rename(src_path, dst_path).map_err(|e| format!("Cannot move '{}' to '{}': {}", src, dst, e))
}

#[tauri::command]
fn rename_file(path: String, new_name: String) -> Result<(), String> {
    let src = Path::new(&path);
    if !src.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let parent = src
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory for: {}", path))?;
    let new_path = parent.join(&new_name);
    fs::rename(src, &new_path).map_err(|e| format!("Cannot rename to '{}': {}", new_name, e))
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    remove_dir_recursive(target)
}

#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<(), String> {
    let new_path = Path::new(&parent).join(&name);
    if new_path.exists() {
        return Err(format!("'{}' already exists", name));
    }
    fs::create_dir(&new_path).map_err(|e| format!("Cannot create folder '{}': {}", name, e))
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if file_path.exists() {
        return Err(format!("'{}' already exists", path));
    }
    let parent = file_path
        .parent()
        .ok_or_else(|| "Invalid path".to_string())?;
    if !parent.exists() {
        return Err(format!(
            "Parent directory does not exist: {}",
            parent.display()
        ));
    }
    std::fs::File::create(file_path)
        .map(|_| ())
        .map_err(|e| format!("Cannot create file: {}", e))
}

// ---------------------------------------------------------------------------
// Tag / database commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn index_directory(dir_path: String) -> Result<usize, String> {
    db::index_directory(&dir_path)
}

#[tauri::command]
fn create_tag(name: String, color: String) -> Result<db::Tag, String> {
    db::create_tag(&name, &color)
}

#[tauri::command]
fn get_all_tags() -> Result<Vec<db::Tag>, String> {
    db::get_all_tags()
}

#[tauri::command]
fn update_tag(id: i64, name: String, color: String) -> Result<(), String> {
    db::update_tag(id, &name, &color)
}

#[tauri::command]
fn delete_tag(id: i64) -> Result<(), String> {
    db::delete_tag(id)
}

#[tauri::command]
fn add_tag_to_file(file_path: String, tag_id: i64) -> Result<(), String> {
    db::add_tag_to_file(&file_path, tag_id)
}

#[tauri::command]
fn remove_tag_from_file(file_path: String, tag_id: i64) -> Result<(), String> {
    db::remove_tag_from_file(&file_path, tag_id)
}

#[tauri::command]
fn get_tags_for_file(file_path: String) -> Result<Vec<db::Tag>, String> {
    db::get_tags_for_file(&file_path)
}

#[tauri::command]
fn get_tags_for_files(
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, Vec<db::Tag>>, String> {
    db::get_tags_for_files(&paths)
}

#[tauri::command]
fn add_tag_to_folder_recursive(folder_path: String, tag_id: i64) -> Result<usize, String> {
    db::add_tag_to_folder_recursive(&folder_path, tag_id)
}

#[tauri::command]
fn get_files_by_tags(
    tag_ids: Vec<i64>,
    max_results: Option<usize>,
) -> Result<Vec<db::FileWithTags>, String> {
    db::get_files_by_tags(tag_ids, max_results)
}

#[tauri::command]
fn search_files(query: String, root_path: String) -> Result<Vec<FileEntry>, String> {
    let lower_query = query.to_lowercase();
    let mut results = Vec::new();
    let max_results = 500;

    let walker = walkdir::WalkDir::new(&root_path)
        .max_depth(20)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Skip hidden files/folders (starting with .)
            !e.file_name()
                .to_str()
                .map(|s| s.starts_with('.'))
                .unwrap_or(false)
        });

    for entry in walker {
        if results.len() >= max_results {
            break;
        }
        match entry {
            Ok(dir_entry) => {
                let file_name = dir_entry.file_name().to_string_lossy().to_lowercase();
                if !file_name.contains(&lower_query) {
                    // Only recurse into dirs that might contain matches
                    // but always include dirs in traversal
                    continue;
                }
                let metadata = match dir_entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let is_dir = metadata.is_dir();
                let size = if is_dir { 0 } else { metadata.len() };
                let is_executable = if is_dir {
                    false
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        metadata.permissions().mode() & 0o111 != 0
                    }
                    #[cfg(not(unix))]
                    {
                        false
                    }
                };
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| {
                        chrono::DateTime::from_timestamp(
                            t.duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs() as i64,
                            0,
                        )
                    })
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|| "Unknown".to_string());

                results.push(FileEntry {
                    name: dir_entry.file_name().to_string_lossy().to_string(),
                    path: dir_entry.path().to_string_lossy().to_string(),
                    is_dir,
                    size,
                    modified,
                    is_executable,
                });
            }
            Err(_) => continue,
        }
    }

    results.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(results)
}

#[tauri::command]
fn watch_directory(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Cannot create watcher: {}", e))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Cannot watch directory: {}", e))?;

    // Store watcher (drop old one)
    {
        let mut guard = FILE_WATCHER
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(watcher);
    }

    // Spawn a thread to forward events to the frontend
    std::thread::spawn(move || {
        for event in rx {
            let kind_str = match event.kind {
                EventKind::Create(_) => "create",
                EventKind::Modify(_) => "modify",
                EventKind::Remove(_) => "remove",
                _ => "other",
            };
            let _ = app.emit("fs-change", serde_json::json!({
                "kind": kind_str,
                "paths": event.paths.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
            }));
        }
    });

    Ok(())
}

#[tauri::command]
fn get_system_thumbnail(path: String) -> Result<String, String> {
    Ok(thumbnail_for_path(&path, true))
}

#[tauri::command]
fn get_system_thumbnails(paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        let thumb = thumbnail_for_path(&path, false); // no generation — cache only
        results.push((path, thumb));
    }
    Ok(results)
}

fn thumbnail_for_path(path: &str, generate: bool) -> String {
    // Freedesktop thumbnail cache: ~/.thumbnails/{normal,large}/{md5}.png
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return String::new(),
    };
    let uri = format!("file://{}", path);
    let digest = md5::Md5::digest(uri.as_bytes());
    let hex = format!("{:x}", digest);
    let sizes = ["normal", "large"];
    let thumb_dir = home.join(".thumbnails");
    for size in &sizes {
        let thumb_path = thumb_dir.join(size).join(format!("{}.png", hex));
        if thumb_path.exists() {
            if let Ok(bytes) = std::fs::read(&thumb_path) {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return format!("data:image/png;base64,{}", b64);
            }
            return String::new();
        }
    }
    // Check fail cache
    let fail_path = thumb_dir.join("fail").join(format!("{}.png", hex));
    if fail_path.exists() {
        return String::new();
    }
    // Don't generate in cache-only mode
    if !generate {
        return String::new();
    }
    // Try to generate thumbnail using system tools
    let thumb_dir = thumb_dir.join("normal");
    std::fs::create_dir_all(&thumb_dir).ok();
    let thumb_path = thumb_dir.join(format!("{}.png", hex));
    let thumb_str = thumb_path.to_string_lossy().to_string();
    let output = std::process::Command::new("ffmpegthumbnailer")
        .args(["-i", &path, "-o", &thumb_str, "-s", "128", "-q", "5"])
        .output();
    if let Ok(out) = output {
        if out.status.success() && thumb_path.exists() {
            if let Ok(bytes) = std::fs::read(&thumb_path) {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return format!("data:image/png;base64,{}", b64);
            }
        }
    }
    // Fall back: try ImageMagick
    let output = std::process::Command::new("convert")
        .args([&path, "-thumbnail", "128x128", &thumb_str])
        .output();
    if let Ok(out) = output {
        if out.status.success() && thumb_path.exists() {
            if let Ok(bytes) = std::fs::read(&thumb_path) {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return format!("data:image/png;base64,{}", b64);
            }
        }
    }
    // Mark as fail so we don't try again
    std::fs::create_dir_all(thumb_dir.join("fail")).ok();
    let _ = std::fs::write(thumb_dir.join("fail").join(format!("{}.png", hex)), b"");
    String::new()
}

fn ext_to_icon_name(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "txt" | "md" | "rtf" | "log" => "text-plain",
        "pdf" => "application-pdf",
        "doc" | "docx" => "application-msword",
        "xls" | "xlsx" => "application-spreadsheet",
        "ppt" | "pptx" => "application-presentation",
        "py" | "js" | "ts" | "rs" | "go" | "java" | "c" | "cpp" | "h" | "css" | "html" | "json"
        | "xml" => "text-x-script",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" => "image-x-generic",
        "mp3" | "wav" | "flac" | "ogg" | "aac" | "wma" => "audio-x-generic",
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" => "video-x-generic",
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" => "application-x-archive",
        "exe" | "appimage" | "bin" => "application-x-executable",
        "iso" | "img" => "application-x-cd-image",
        "deb" | "rpm" => "application-x-deb",
        "dmg" => "application-x-dmg",
        "ttf" | "otf" | "woff" | "woff2" => "font-x-generic",
        _ => "",
    }
}

fn find_icon_path(name: &str, size: usize) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    // Try hicolor theme first, then Adwaita, then gnome, then use base dir
    let themes = [
        "hicolor",
        "Adwaita",
        "gnome",
        "Humanity",
        "Papirus",
        "elementary-xfce",
        "nuoveXT2",
    ];
    let subdirs = [
        format!("{}x{}/mimetypes", size, size),
        "scalable/mimetypes".to_string(),
        "48x48/mimetypes".to_string(),
    ];
    for theme in &themes {
        for sub in &subdirs {
            let p = Path::new("/usr/share/icons")
                .join(theme)
                .join(sub)
                .join(format!("{}.png", name));
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
            let p_svg = Path::new("/usr/share/icons")
                .join(theme)
                .join("scalable")
                .join("mimetypes")
                .join(format!("{}.svg", name));
            if p_svg.exists() {
                return Some(p_svg.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[tauri::command]
fn get_system_icon(path: String) -> Result<String, String> {
    Ok(get_system_icon_inner(&path))
}

#[tauri::command]
fn get_system_icons(paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        let icon = get_system_icon_inner(&path);
        results.push((path, icon));
    }
    Ok(results)
}

/// Returns the icon as a base64 data URI (empty string if not found).
fn get_system_icon_inner(path: &str) -> String {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if ext == "desktop" {
        if let Ok(content) = std::fs::read_to_string(path) {
            for line in content.lines() {
                if let Some(icon_name) = line.strip_prefix("Icon=") {
                    if let Some(p) = find_icon_path(icon_name, 48) {
                        if let Ok(bytes) = std::fs::read(&p) {
                            use base64::Engine;
                            return format!(
                                "data:{};base64,{}",
                                if p.ends_with(".svg") {
                                    "image/svg+xml"
                                } else {
                                    "image/png"
                                },
                                base64::engine::general_purpose::STANDARD.encode(&bytes)
                            );
                        }
                    }
                }
            }
        }
    }
    let icon_name = ext_to_icon_name(&ext);
    if let Some(p) = find_icon_path(icon_name, 48) {
        if let Ok(bytes) = std::fs::read(&p) {
            use base64::Engine;
            return format!(
                "data:{};base64,{}",
                if p.ends_with(".svg") {
                    "image/svg+xml"
                } else {
                    "image/png"
                },
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
        }
    }
    for icon in ["text-x-generic", "unknown", "application-octet-stream"] {
        if let Some(p) = find_icon_path(icon, 48) {
            if let Ok(bytes) = std::fs::read(&p) {
                use base64::Engine;
                return format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(&bytes)
                );
            }
        }
    }
    String::new()
}

#[tauri::command]
fn tantivy_index(path: String) -> Result<usize, String> {
    search::index_directory(&path)
}

#[tauri::command]
fn tantivy_search(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<search::SearchResult>, String> {
    search::search(&query, limit.unwrap_or(100))
}

#[tauri::command]
fn get_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {}", e))?;
    let mime = match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "image/png", // fallback
    };
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Cannot open file: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Cannot open file: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Cannot open file: {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Disk operations
// ---------------------------------------------------------------------------

#[tauri::command]
fn list_mounted_disks() -> Result<Vec<serde_json::Value>, String> {
    use std::process::Command;
    let output = Command::new("df")
        .args([
            "-T",
            "-x",
            "tmpfs",
            "-x",
            "devtmpfs",
            "-x",
            "squashfs",
            "-x",
            "overlay",
            "-x",
            "proc",
            "-x",
            "sysfs",
            "-x",
            "cgroup2",
            "-x",
            "devpts",
            "-x",
            "securityfs",
            "-x",
            "pstore",
            "-x",
            "efivarfs",
            "-x",
            "bpf",
            "-x",
            "autofs",
            "-x",
            "mqueue",
            "-x",
            "hugetlbfs",
            "-x",
            "debugfs",
            "-x",
            "tracefs",
            "-x",
            "ramfs",
            "-x",
            "configfs",
        ])
        .output()
        .map_err(|e| format!("Cannot list disks: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut disks = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 7 && parts[0].starts_with("/dev/") {
            disks.push(serde_json::json!({
                "device": parts[0], "fs_type": parts[1],
                "total": parts[2], "used": parts[3],
                "available": parts[4], "use_percent": parts[5],
                "mount_point": parts[6],
            }));
        }
    }
    Ok(disks)
}

#[tauri::command]
fn mount_disk(device: String) -> Result<String, String> {
    let output = std::process::Command::new("udisksctl")
        .args(["mount", "-b", &device])
        .output()
        .map_err(|e| format!("Cannot run udisksctl: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "Mount failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[tauri::command]
fn unmount_disk(device: String) -> Result<String, String> {
    let output = std::process::Command::new("udisksctl")
        .args(["unmount", "-b", &device])
        .output()
        .map_err(|e| format!("Cannot run udisksctl: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "Unmount failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    // Try common terminal emulators
    let terminals = [
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "lxterminal",
        "terminator",
        "alacritty",
        "kitty",
        "foot",
    ];

    let found = terminals.iter().find(|cmd| {
        std::process::Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });

    match found {
        Some(term) => {
            std::process::Command::new(term)
                .arg("--working-directory")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Cannot open terminal: {}", e))?;
            Ok(())
        }
        None => Err("No terminal emulator found".to_string()),
    }
}

#[tauri::command]
fn chmod_file(path: String, mode: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let metadata = file_path
        .metadata()
        .map_err(|e| format!("Cannot read metadata: {}", e))?;
    let mut permissions = metadata.permissions();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut mode_bits = permissions.mode();

        match mode.as_str() {
            "+x" => mode_bits |= 0o111,
            "-x" => mode_bits &= !0o111,
            "+r" => mode_bits |= 0o444,
            "-r" => mode_bits &= !0o444,
            "+w" => mode_bits |= 0o222,
            "-w" => mode_bits &= !0o222,
            octal if octal.len() == 3 && octal.chars().all(|c| c.is_ascii_digit()) => {
                let val = u32::from_str_radix(octal, 8)
                    .map_err(|_| format!("Invalid octal mode: {}", octal))?;
                mode_bits = val | (mode_bits & !0o777);
            }
            _ => {
                return Err(format!(
                    "Invalid mode: {}. Use +x, -x, or octal (e.g. 755)",
                    mode
                ))
            }
        }

        permissions.set_mode(mode_bits);
    }

    std::fs::set_permissions(file_path, permissions)
        .map_err(|e| format!("Cannot set permissions: {}", e))?;
    Ok(())
}

#[derive(Debug, Serialize)]
struct UserEntry {
    uid: u32,
    name: String,
}

#[derive(Debug, Serialize)]
struct GroupEntry {
    gid: u32,
    name: String,
}

#[tauri::command]
fn list_users() -> Result<Vec<UserEntry>, String> {
    let content = std::fs::read_to_string("/etc/passwd")
        .map_err(|e| format!("Cannot read /etc/passwd: {}", e))?;
    let mut users = Vec::new();
    for line in content.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 3 {
            if let Ok(uid) = parts[2].parse::<u32>() {
                // Skip system users (uid < 1000) unless they're root
                if uid == 0 || uid >= 1000 {
                    users.push(UserEntry {
                        uid,
                        name: parts[0].to_string(),
                    });
                }
            }
        }
    }
    users.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(users)
}

#[tauri::command]
fn list_groups() -> Result<Vec<GroupEntry>, String> {
    let content = std::fs::read_to_string("/etc/group")
        .map_err(|e| format!("Cannot read /etc/group: {}", e))?;
    let mut groups = Vec::new();
    for line in content.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 3 {
            if let Ok(gid) = parts[2].parse::<u32>() {
                if gid == 0 || gid >= 1000 {
                    groups.push(GroupEntry {
                        gid,
                        name: parts[0].to_string(),
                    });
                }
            }
        }
    }
    groups.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(groups)
}

#[tauri::command]
fn chown_file(path: String, owner: String, group: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let spec = if owner.is_empty() && group.is_empty() {
        return Err("No owner or group specified".to_string());
    } else if owner.is_empty() {
        format!(":{}", group)
    } else if group.is_empty() {
        owner
    } else {
        format!("{}:{}", owner, group)
    };
    let output = std::process::Command::new("chown")
        .arg(&spec)
        .arg(file_path)
        .output()
        .map_err(|e| format!("Cannot run chown: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("chown failed: {}", stderr.trim()));
    }
    Ok(())
}

#[tauri::command]
fn run_executable(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Try to make executable if not already
    #[cfg(unix)]
    {
        let metadata = file_path
            .metadata()
            .map_err(|e| format!("Cannot read metadata: {}", e))?;
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            // Not executable, try to set it
            let mut perms = metadata.permissions();
            let mode = perms.mode() | 0o111;
            perms.set_mode(mode);
            std::fs::set_permissions(file_path, perms).ok();
        }
    }

    let terminals = [
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "lxterminal",
        "terminator",
        "alacritty",
        "kitty",
        "foot",
    ];

    let found = terminals.iter().find(|cmd| {
        std::process::Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });

    match found {
        Some(term) => {
            // gnome-terminal uses "--" to pass command, others use "-e"
            let is_gnome = term.contains("gnome-terminal");
            let mut cmd = std::process::Command::new(term);
            if is_gnome {
                cmd.arg("--").arg(&path);
            } else {
                cmd.arg("-e").arg(&path);
            }
            cmd.spawn()
                .map_err(|e| format!("Cannot run executable: {}", e))?;
            Ok(())
        }
        None => Err("No terminal emulator found".to_string()),
    }
}

#[tauri::command]
fn open_in_editor(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    // Try editors in preference order
    let editors = [
        "code",
        "gnome-text-editor",
        "gedit",
        "kate",
        "vim",
        "nano",
        "emacs",
    ];
    let found = editors.iter().find(|cmd| {
        std::process::Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    });
    match found {
        Some(editor) => {
            std::process::Command::new(editor)
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Cannot open editor: {}", e))?;
            Ok(())
        }
        None => {
            // Fall back to xdg-open
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|_| "No text editor found".to_string())?;
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// File properties command
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct FileProperties {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
    modified: String,
    created: String,
    permissions: String,
    owner: String,
    group: String,
    mime_type: String,
    symlink_target: Option<String>,
    image_dimensions: Option<String>,
}

fn format_permissions(p: std::fs::Permissions) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = p.mode();
        let ft = if mode & 0o040000 != 0 { "d" } else { "-" };
        let ur = if mode & 0o400 != 0 { "r" } else { "-" };
        let uw = if mode & 0o200 != 0 { "w" } else { "-" };
        let ux = if mode & 0o100 != 0 { "x" } else { "-" };
        let gr = if mode & 0o040 != 0 { "r" } else { "-" };
        let gw = if mode & 0o020 != 0 { "w" } else { "-" };
        let gx = if mode & 0o010 != 0 { "x" } else { "-" };
        let or = if mode & 0o004 != 0 { "r" } else { "-" };
        let ow = if mode & 0o002 != 0 { "w" } else { "-" };
        let ox = if mode & 0o001 != 0 { "x" } else { "-" };
        format!(
            "{}{}{}{}{}{}{}{}{}{} ({:o})",
            ft,
            ur,
            uw,
            ux,
            gr,
            gw,
            gx,
            or,
            ow,
            ox,
            mode & 0o777
        )
    }
    #[cfg(not(unix))]
    {
        "N/A".to_string()
    }
}

fn infer_mime_type(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "txt" | "md" | "rtf" | "log" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "webm" => "video/webm",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "bz2" => "application/x-bzip2",
        "xz" => "application/x-xz",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "py" => "text/x-python",
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        "jsx" => "text/jsx",
        "go" => "text/x-go",
        "java" => "text/x-java",
        "c" => "text/x-c",
        "cpp" | "cxx" | "cc" => "text/x-c++",
        "h" | "hpp" => "text/x-c-header",
        "sh" | "bash" | "zsh" => "application/x-shellscript",
        "yaml" | "yml" => "application/x-yaml",
        "toml" => "application/toml",
        "deb" => "application/vnd.debian.binary-package",
        "rpm" => "application/x-rpm",
        "appimage" => "application/x-appimage",
        "iso" => "application/x-iso9660-image",
        "exe" => "application/x-msdownload",
        "so" => "application/x-sharedlib",
        "dmg" => "application/x-apple-diskimage",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" | "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn get_image_dimensions(path: &str) -> Option<String> {
    // Try `identify` from ImageMagick first, then `file` command
    if let Ok(out) = std::process::Command::new("identify")
        .args(["-format", "%wx%h", path])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    // Fallback: parse `file` output (e.g. "PNG image data, 1920 x 1080, 8-bit...")
    if let Ok(out) = std::process::Command::new("file").args([path]).output() {
        let s = String::from_utf8_lossy(&out.stdout);
        // Match patterns like "1920 x 1080" or "1920x1080"
        if let Some(cap) = s.lines().next().and_then(|line| {
            let re = regex_lite::Regex::new(r"(\d+)\s*[x×]\s*(\d+)").ok()?;
            re.captures(line)
        }) {
            return Some(format!("{}×{}", &cap[1], &cap[2]));
        }
    }
    None
}

#[tauri::command]
fn get_file_properties(path: String) -> Result<FileProperties, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let metadata = file_path
        .metadata()
        .map_err(|e| format!("Cannot read metadata: {}", e))?;
    let name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let ts_to_str = |t: std::time::SystemTime| -> String {
        chrono::DateTime::from_timestamp(
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
            0,
        )
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "Unknown".to_string())
    };

    let modified = metadata
        .modified()
        .map(ts_to_str)
        .unwrap_or_else(|_| "Unknown".to_string());
    let created = metadata
        .created()
        .map(ts_to_str)
        .unwrap_or_else(|_| "Unknown".to_string());

    let permissions = format_permissions(metadata.permissions());

    #[cfg(unix)]
    let (owner, group): (String, String) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.uid().to_string(), metadata.gid().to_string())
    };
    #[cfg(not(unix))]
    let (owner, group) = ("N/A".to_string(), "N/A".to_string());

    let mime_type = infer_mime_type(&path);

    let symlink_target = if file_path.is_symlink() {
        file_path
            .read_link()
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    } else {
        None
    };

    let image_extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"];
    let is_image = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| image_extensions.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false);
    let image_dimensions = if is_image {
        get_image_dimensions(&path)
    } else {
        None
    };

    Ok(FileProperties {
        name,
        path: file_path.to_string_lossy().to_string(),
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        modified,
        created,
        permissions,
        owner,
        group,
        mime_type,
        symlink_target,
        image_dimensions,
    })
}

// ---------------------------------------------------------------------------
// Archive operations
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ArchiveEntry {
    name: String,
    size: String,
    compressed_size: String,
    is_dir: bool,
    date: String,
}

fn detect_archive(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    if lower.ends_with(".zip") {
        Some("zip")
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Some("tar.gz")
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        Some("tar.bz2")
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        Some("tar.xz")
    } else if lower.ends_with(".tar") {
        Some("tar")
    } else if lower.ends_with(".7z") {
        Some("7z")
    } else if lower.ends_with(".rar") {
        Some("rar")
    } else {
        None
    }
}

#[tauri::command]
fn list_archive(path: String) -> Result<Vec<ArchiveEntry>, String> {
    let ext = detect_archive(&path).ok_or_else(|| format!("Unsupported format: {}", path))?;
    let output = match ext {
        "zip" => std::process::Command::new("unzip")
            .args(["-l", &path])
            .output()
            .map_err(|e| format!("unzip not found: {}", e))?,
        "7z" | "rar" => std::process::Command::new("7z")
            .args(["l", &path])
            .output()
            .map_err(|e| format!("7z not found: {}", e))?,
        _ => std::process::Command::new("tar")
            .args(["-tvf", &path])
            .output()
            .map_err(|e| format!("tar not found: {}", e))?,
    };
    if !output.status.success() {
        return Err(format!(
            "Cannot list: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter_map(|line| {
            let t = line.trim();
            if t.is_empty()
                || t.starts_with("Archive:")
                || t.starts_with("Length")
                || t.starts_with("---")
                || t.contains("--------")
                || t.starts_with("Total")
                || t.starts_with("Path =")
                || t.starts_with("Physical Size =")
            {
                return None;
            }
            Some(ArchiveEntry {
                name: t.to_string(),
                size: String::new(),
                compressed_size: String::new(),
                is_dir: t.ends_with('/'),
                date: String::new(),
            })
        })
        .collect())
}

#[tauri::command]
fn extract_archive(path: String, dest_dir: String, mode: String) -> Result<String, String> {
    let ext = detect_archive(&path).ok_or_else(|| format!("Unsupported format: {}", path))?;
    let dest_path = if mode == "named" || mode == "here" {
        let base = std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "extracted".to_string());
        std::path::Path::new(&dest_dir).join(&base)
    } else {
        std::path::PathBuf::from(&dest_dir)
    };
    std::fs::create_dir_all(&dest_path).map_err(|e| format!("Cannot create: {}", e))?;
    let dest = dest_path.to_string_lossy().to_string();
    let output = match ext {
        "zip" => std::process::Command::new("unzip")
            .args(["-o", &path, "-d", &dest])
            .output()
            .map_err(|e| format!("unzip error: {}", e))?,
        "7z" | "rar" => std::process::Command::new("7z")
            .args(["x", &path, &format!("-o{}", &dest), "-y"])
            .output()
            .map_err(|e| format!("7z error: {}", e))?,
        _ => std::process::Command::new("tar")
            .args(["-xf", &path, "-C", &dest])
            .output()
            .map_err(|e| format!("tar error: {}", e))?,
    };
    if output.status.success() {
        Ok(dest)
    } else {
        Err(format!(
            "Extract failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_directory,
            copy_file,
            move_file,
            rename_file,
            delete_file,
            create_folder,
            create_file,
            get_file_properties,
            index_directory,
            create_tag,
            get_all_tags,
            update_tag,
            delete_tag,
            add_tag_to_file,
            remove_tag_from_file,
            get_tags_for_file,
            get_tags_for_files,
            add_tag_to_folder_recursive,
            get_files_by_tags,
            search_files,
            watch_directory,
            open_file,
            get_file_base64,
            get_system_thumbnail,
            get_system_thumbnails,
            get_system_icon,
            get_system_icons,
            tantivy_index,
            tantivy_search,
            list_mounted_disks,
            mount_disk,
            unmount_disk,
            open_terminal,
            chmod_file,
            list_users,
            list_groups,
            chown_file,
            run_executable,
            open_in_editor,
            get_file_properties,
            list_archive,
            extract_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
