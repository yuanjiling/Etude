use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

static DATABASE_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  source_path TEXT,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  library_relative_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  modified_at INTEGER,
  pixel_width INTEGER,
  pixel_height INTEGER,
  tag_status TEXT,
  tag_error TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  practice_count INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  record_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS images_source_path_unique
  ON images(source_path COLLATE NOCASE) WHERE source_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS images_practice_priority
  ON images(hidden, last_seen, practice_count);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS image_tags (
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'current',
  PRIMARY KEY (image_id, tag_id, source)
);
CREATE INDEX IF NOT EXISTS image_tags_lookup ON image_tags(tag_id, image_id);
CREATE TABLE IF NOT EXISTS crop_regions (
  id TEXT NOT NULL,
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  person_index INTEGER,
  tag TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (image_id, id)
);
CREATE TABLE IF NOT EXISTS practice_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  image_count INTEGER NOT NULL,
  record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_history (
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  image_id TEXT NOT NULL,
  image_snapshot_json TEXT NOT NULL,
  focus_region_json TEXT,
  PRIMARY KEY (session_id, position)
);
CREATE INDEX IF NOT EXISTS practice_history_image ON practice_history(image_id, session_id);
PRAGMA user_version = 1;
"#;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("etude.db"))
}

fn open(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(SCHEMA)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn legacy_data_paths(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let current = data_dir(app)?;
    Ok(vec![current.join("app_data.json")])
}

fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn integer(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn boolean(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn save_state_transaction(tx: &Transaction<'_>, state: &Value) -> Result<(), String> {
    tx.execute_batch(
        "DELETE FROM practice_history; DELETE FROM practice_sessions; DELETE FROM practice_sets; \
         DELETE FROM crop_regions; DELETE FROM image_tags; DELETE FROM tags; DELETE FROM images;",
    )
    .map_err(|error| error.to_string())?;

    for image in state
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = string(image, "id") else {
            continue;
        };
        let source_path = string(image, "sourcePath").filter(|path| !path.is_empty());
        tx.execute(
            "INSERT INTO images (id, source_path, url, thumbnail_url, library_relative_path, file_name, file_size, modified_at, pixel_width, pixel_height, tag_status, tag_error, favorite, hidden, practice_count, skip_count, last_seen, record_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                id,
                source_path,
                string(image, "url").unwrap_or_default(),
                string(image, "thumbnailUrl"),
                string(image, "libraryRelativePath"),
                string(image, "fileName"),
                integer(image, "fileSize"),
                integer(image, "modifiedAt"),
                integer(image, "pixelWidth"),
                integer(image, "pixelHeight"),
                string(image, "tagStatus"),
                string(image, "tagError"),
                boolean(image, "favorite"),
                boolean(image, "hidden"),
                integer(image, "practice_count").unwrap_or(0),
                integer(image, "skip_count").unwrap_or(0),
                integer(image, "last_seen"),
                serde_json::to_string(image).map_err(|error| error.to_string())?,
            ],
        )
        .map_err(|error| format!("保存图片 {id} 失败：{error}"))?;

        for tag in image
            .get("tags")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])
                .map_err(|error| error.to_string())?;
            let tag_id: i64 = tx
                .query_row("SELECT id FROM tags WHERE name = ?1", [tag], |row| {
                    row.get(0)
                })
                .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?1, ?2, 'current')",
                params![id, tag_id],
            )
            .map_err(|error| error.to_string())?;
        }

        for region in image
            .pointer("/poseAnalysis/regions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(region_id) = string(region, "id") else {
                continue;
            };
            tx.execute(
                "INSERT INTO crop_regions (id, image_id, person_index, tag, x, y, width, height, confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    region_id,
                    id,
                    integer(region, "personIndex"),
                    string(region, "tag").unwrap_or_default(),
                    region.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                    region.get("y").and_then(Value::as_f64).unwrap_or(0.0),
                    region.get("width").and_then(Value::as_f64).unwrap_or(0.0),
                    region.get("height").and_then(Value::as_f64).unwrap_or(0.0),
                    region.get("confidence").and_then(Value::as_f64).unwrap_or(0.0),
                ],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    for set in state
        .get("sets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = string(set, "id") else {
            continue;
        };
        tx.execute(
            "INSERT INTO practice_sets (id, name, config_json) VALUES (?1, ?2, ?3)",
            params![
                id,
                string(set, "name").unwrap_or_default(),
                serde_json::to_string(set.get("config").unwrap_or(&Value::Null))
                    .map_err(|error| error.to_string())?,
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    for session in state
        .get("history")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = string(session, "id") else {
            continue;
        };
        tx.execute(
            "INSERT INTO practice_sessions (id, started_at, duration_sec, image_count, record_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                integer(session, "date").unwrap_or(0),
                integer(session, "durationSec").unwrap_or(0),
                integer(session, "imageCount").unwrap_or(0),
                serde_json::to_string(session).map_err(|error| error.to_string())?,
            ],
        )
        .map_err(|error| error.to_string())?;

        let items: Vec<(Value, Option<Value>)> =
            if let Some(items) = session.get("items").and_then(Value::as_array) {
                items
                    .iter()
                    .filter_map(|item| {
                        item.get("image")
                            .cloned()
                            .map(|image| (image, item.get("focusRegion").cloned()))
                    })
                    .collect()
            } else {
                session
                    .get("images")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .cloned()
                    .map(|image| (image, None))
                    .collect()
            };
        for (position, (image, focus_region)) in items.into_iter().enumerate() {
            let Some(image_id) = string(&image, "id") else {
                continue;
            };
            tx.execute(
                "INSERT INTO practice_history (session_id, position, image_id, image_snapshot_json, focus_region_json) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    id,
                    position as i64,
                    image_id,
                    serde_json::to_string(&image).map_err(|error| error.to_string())?,
                    focus_region.map(|region| serde_json::to_string(&region)).transpose().map_err(|error| error.to_string())?,
                ],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn save_state_path(path: &Path, state: &Value) -> Result<(), String> {
    let mut connection = open(path)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    save_state_transaction(&tx, state)?;
    tx.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('state_initialized', '1')",
        [],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

fn migrate_legacy(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let connection = open(path)?;
    let completed: Option<String> = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'legacy_app_data_migrated'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    drop(connection);
    if completed.is_some() {
        return Ok(());
    }

    for legacy_path in legacy_data_paths(app)? {
        if !legacy_path.exists() {
            continue;
        }
        let legacy: Value = serde_json::from_str(
            &fs::read_to_string(&legacy_path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("旧数据文件 {} 无法解析：{error}", legacy_path.display()))?;
        save_state_path(path, &legacy)?;
        break;
    }
    let connection = open(path)?;
    connection
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('legacy_app_data_migrated', '1')",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_values(connection: &Connection, sql: &str) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let serialized = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&serialized).map_err(|error| error.to_string())
    })
    .collect()
}

#[tauri::command]
pub fn read_app_state(app: tauri::AppHandle) -> Result<String, String> {
    let _guard = DATABASE_LOCK
        .lock()
        .map_err(|_| "数据库写入锁已损坏".to_string())?;
    let path = database_path(&app)?;
    migrate_legacy(&app, &path)?;
    let connection = open(&path)?;
    let initialized: Option<String> = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'state_initialized'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if initialized.is_none() {
        return Ok("{}".into());
    }
    let images = load_values(&connection, "SELECT record_json FROM images ORDER BY rowid")?;
    let sets = {
        let mut statement = connection
            .prepare("SELECT id, name, config_json FROM practice_sets ORDER BY rowid")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.map(|row| {
            let (id, name, config) = row.map_err(|error| error.to_string())?;
            let config: Value = serde_json::from_str(&config).map_err(|error| error.to_string())?;
            Ok(json!({ "id": id, "name": name, "config": config }))
        })
        .collect::<Result<Vec<Value>, String>>()?
    };
    let history = load_values(
        &connection,
        "SELECT record_json FROM practice_sessions ORDER BY started_at DESC, rowid DESC",
    )?;
    serde_json::to_string(&json!({ "images": images, "sets": sets, "history": history }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_app_state(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let _guard = DATABASE_LOCK
        .lock()
        .map_err(|_| "数据库写入锁已损坏".to_string())?;
    let state: Value =
        serde_json::from_str(&data).map_err(|error| format!("应用数据无效：{error}"))?;
    save_state_path(&database_path(&app)?, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_round_trip_preserves_ids_and_history() {
        let directory = std::env::temp_dir().join(format!("etude-db-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("etude.db");
        let state = json!({
            "images": [{"id":"img-1","url":"asset://one","sourcePath":"C:/art/one.jpg","tags":["人物","动态"],"practice_count":2,"favorite":true,"hidden":false,"skip_count":0,"poseAnalysis":{"regions":[]}}],
            "sets": [{"id":"set-1","name":"热身","config":{"includeTags":["动态"],"excludeTags":[],"sessionType":"single"}}],
            "history": [{"id":"history-1","date":123,"durationSec":60,"imageCount":1,"images":[{"id":"img-1","url":"asset://one","tags":[],"practice_count":2,"favorite":true,"hidden":false,"skip_count":0}]}]
        });
        save_state_path(&path, &state).unwrap();
        let connection = open(&path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM images", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM image_tags", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM practice_history", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }
}
