use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

static SETTINGS_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}

fn legacy_data_paths(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let current = data_dir(app)?;
    Ok(vec![current.join("app_data.json")])
}

fn legacy_settings(app: &tauri::AppHandle) -> Result<Option<Value>, String> {
    for path in legacy_data_paths(app)? {
        if !path.exists() {
            continue;
        }
        let value: Value =
            serde_json::from_str(&fs::read_to_string(&path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("旧数据文件 {} 无法解析：{error}", path.display()))?;
        if let Some(settings) = value.get("settings") {
            let mut settings = settings.clone();
            if settings.get("theme").is_none() {
                if let Some(dark_mode) = value.get("darkMode").and_then(Value::as_bool) {
                    settings["theme"] =
                        Value::String(if dark_mode { "dark" } else { "light" }.into());
                }
            }
            return Ok(Some(settings));
        }
    }
    Ok(None)
}

pub fn read(app: &tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(app)?;
    if path.exists() {
        return fs::read_to_string(path).map_err(|error| error.to_string());
    }
    if let Some(settings) = legacy_settings(app)? {
        let serialized =
            serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
        fs::write(&path, &serialized).map_err(|error| error.to_string())?;
        return Ok(serialized);
    }
    Ok("{}".into())
}

pub fn write(app: &tauri::AppHandle, data: &str) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(data).map_err(|error| format!("设置数据无效：{error}"))?;
    let serialized = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(settings_path(app)?, serialized).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_settings(app: tauri::AppHandle) -> Result<String, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "设置写入锁已损坏".to_string())?;
    read(&app)
}

#[tauri::command]
pub fn write_settings(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "设置写入锁已损坏".to_string())?;
    write(&app, &data)
}
