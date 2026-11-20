// Local-first, hash-addressed media attachments (design handoff
// attachments.zip, tracker e16588b6). Bytes live in this app's own
// data directory -- never synced, never in the project JSONL, which
// only ever carries the hash. One global, flat-by-prefix,
// content-addressed store (not per-project folders): identical bytes
// attached in two different projects hash identically and are only
// ever stored once. Project membership is derived elsewhere (by
// scanning which projects' markdown actually references a given
// hash), not tracked here -- this module only knows "hash -> bytes",
// nothing about issues/projects/comments.
//
// Hashing itself happens in JS (crypto.subtle.digest -- no need for a
// Rust hashing crate just to re-derive what the caller already
// computed); this module only ever trusts the hash string it's given
// and validates its SHAPE (64 lowercase hex chars, a real SHA-256
// digest) before using it to build a filesystem path -- the one
// genuine security boundary here, since a hash that wasn't actually
// validated could otherwise be used for path traversal (`../../etc`).
// Sharded two-hex-char prefix directories (same idea as git's own
// object store) so one project's worth of attachments never dumps
// thousands of files into one flat directory.
use std::fs;
use std::io::Write;
use tauri::Manager;

fn is_valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn media_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn path_for_hash(app: &tauri::AppHandle, hash: &str) -> Result<std::path::PathBuf, String> {
    if !is_valid_hash(hash) {
        return Err("not a valid sha256 hash".into());
    }
    Ok(media_root(app)?.join(&hash[0..2]).join(hash))
}

#[tauri::command]
pub fn media_store_write(app: tauri::AppHandle, hash: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = path_for_hash(&app, &hash)?;
    // Content-addressed: if a file already lives at this hash, its
    // bytes are guaranteed identical (barring an actual SHA-256
    // collision) -- skip the write rather than re-write identical
    // bytes on every re-attach of something already stored.
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write to a temp file in the same directory then rename, so a
    // crash/power-loss mid-write can never leave a half-written file
    // sitting at the real hash path (which would then be silently
    // treated as "present" by the exists() check above forever,
    // serving truncated bytes on every future read).
    let tmp_path = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn media_store_read(app: tauri::AppHandle, hash: String) -> Result<Option<Vec<u8>>, String> {
    let path = path_for_hash(&app, &hash)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn media_store_exists(app: tauri::AppHandle, hash: String) -> Result<bool, String> {
    Ok(path_for_hash(&app, &hash)?.exists())
}

// Resolves a hash to its real absolute path for tauri-plugin-opener's
// revealItemInDir, called from JS -- not for reading the bytes (that's
// media_store_read above). None if nothing is stored at this hash.
#[tauri::command]
pub fn media_store_reveal_path(app: tauri::AppHandle, hash: String) -> Result<Option<String>, String> {
    let path = path_for_hash(&app, &hash)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[derive(serde::Serialize)]
pub struct MediaStoreEntry {
    hash: String,
    size: u64,
}

// Every hash this device actually has bytes for, plus each one's size
// -- the single source for both "118 files / 2.1 GB stored locally"
// (Settings) and "do I have this hash" lookups (Send-by-hash, the
// Receive auto-match pass) without a round trip per hash. Walks the
// two-level shard layout directly rather than keeping a separate
// index file -- the filesystem IS the index, and this only ever runs
// for a human looking at Settings or doing an explicit lookup, not on
// a hot path.
#[tauri::command]
pub fn media_store_list(app: tauri::AppHandle) -> Result<Vec<MediaStoreEntry>, String> {
    let root = media_root(&app)?;
    let mut out = Vec::new();
    let shard_dirs = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for shard in shard_dirs {
        let shard = shard.map_err(|e| e.to_string())?;
        if !shard.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let entries = fs::read_dir(shard.path()).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            // Skip a crashed-mid-write leftover (write_file's own
            // tmp_path uses this exact extension) -- it's neither a
            // valid hash's real file nor safe to report as present.
            if file_name.ends_with(".tmp") || !is_valid_hash(&file_name) {
                continue;
            }
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            out.push(MediaStoreEntry { hash: file_name, size });
        }
    }
    Ok(out)
}
