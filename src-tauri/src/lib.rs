#[tauri::command]
fn start_native_drag(window: tauri::Window) {
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::Foundation::{HWND, POINT};
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_RBUTTON};
            use windows::Win32::UI::WindowsAndMessaging::{
                GetCursorPos, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
            };

            let mut start_cursor = POINT { x: 0, y: 0 };
            let _ = GetCursorPos(&mut start_cursor);

            let Ok(pos) = window.outer_position() else {
                return;
            };
            let Ok(raw_hwnd) = window.hwnd() else {
                return;
            };
            let hwnd = HWND(raw_hwnd.0 as _);
            let start_window_x = pos.x as i32;
            let start_window_y = pos.y as i32;

            while (GetAsyncKeyState(VK_RBUTTON.0 as i32) as i16) < 0 {
                let mut current_cursor = POINT { x: 0, y: 0 };
                let _ = GetCursorPos(&mut current_cursor);

                let delta_x = current_cursor.x - start_cursor.x;
                let delta_y = current_cursor.y - start_cursor.y;

                let new_x = start_window_x + delta_x;
                let new_y = start_window_y + delta_y;

                let _ = SetWindowPos(
                    hwnd,
                    None,
                    new_x,
                    new_y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
    });
}

#[tauri::command]
fn set_window_click_through(window: tauri::Window, ignore: bool) {
    set_click_through(&window, ignore);
}

fn set_click_through(window: &tauri::Window, ignore: bool) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd_val = HWND(hwnd.0 as _);
            let mut ex_style = GetWindowLongW(hwnd_val, GWL_EXSTYLE);

            // Ensure WS_EX_LAYERED is set (required for WS_EX_TRANSPARENT on some versions)
            ex_style |= WS_EX_LAYERED.0 as i32;

            if ignore {
                ex_style |= WS_EX_TRANSPARENT.0 as i32;
            } else {
                ex_style &= !(WS_EX_TRANSPARENT.0 as i32);
            }

            SetWindowLongW(hwnd_val, GWL_EXSTYLE, ex_style);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.set_ignore_cursor_events(ignore);
    }
}

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static LOCK_MONITOR_ACTIVE: once_cell::sync::Lazy<AtomicBool> =
    once_cell::sync::Lazy::new(|| AtomicBool::new(false));
static LOCK_MONITOR_IN_HOTSPOT: once_cell::sync::Lazy<AtomicBool> =
    once_cell::sync::Lazy::new(|| AtomicBool::new(false));
static PRACTICE_LOCKED: once_cell::sync::Lazy<AtomicBool> =
    once_cell::sync::Lazy::new(|| AtomicBool::new(false));
static LOCK_MONITOR_GENERATION: once_cell::sync::Lazy<AtomicU64> =
    once_cell::sync::Lazy::new(|| AtomicU64::new(0));

fn apply_practice_lock(window: &tauri::Window, locked: bool) {
    PRACTICE_LOCKED.store(locked, Ordering::SeqCst);
    let cursor_over_hotspot = LOCK_MONITOR_IN_HOTSPOT.load(Ordering::SeqCst);
    set_click_through(window, locked && !cursor_over_hotspot);
    let _ = window.emit("practice-lock-changed", locked);
}

#[tauri::command]
fn set_practice_locked(window: tauri::Window, locked: bool) -> bool {
    apply_practice_lock(&window, locked);
    locked
}

#[tauri::command]
fn toggle_practice_locked(window: tauri::Window) -> bool {
    let locked = !PRACTICE_LOCKED.load(Ordering::SeqCst);
    apply_practice_lock(&window, locked);
    locked
}

#[tauri::command]
fn start_lock_monitor(window: tauri::Window, locked: bool) -> bool {
    let generation = LOCK_MONITOR_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    LOCK_MONITOR_ACTIVE.store(true, Ordering::SeqCst);
    LOCK_MONITOR_IN_HOTSPOT.store(false, Ordering::SeqCst);
    apply_practice_lock(&window, locked);

    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::Foundation::{HWND, POINT};
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
            use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

            let _hwnd = match window.hwnd() {
                Ok(h) => HWND(h.0 as _),
                Err(_) => return,
            };
            let mut mouse_was_down = false;

            while LOCK_MONITOR_ACTIVE.load(Ordering::SeqCst)
                && LOCK_MONITOR_GENERATION.load(Ordering::SeqCst) == generation
            {
                let mut cursor = POINT { x: 0, y: 0 };
                unsafe {
                    let _ = GetCursorPos(&mut cursor);
                }

                // Get window position and size
                let pos = match window.outer_position() {
                    Ok(p) => p,
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        continue;
                    }
                };
                let size = match window.outer_size() {
                    Ok(s) => s,
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        continue;
                    }
                };

                // The WebView icon is visual only. Rust owns this native hit area.
                let scale = window.scale_factor().unwrap_or(1.0);
                let hotspot_w = (48.0 * scale).round() as i32;
                let hotspot_h = (36.0 * scale).round() as i32;
                let center_x = pos.x + (size.width as i32) / 2;
                let hotspot_left = center_x - hotspot_w / 2;
                let hotspot_right = center_x + hotspot_w / 2;
                let hotspot_top = pos.y;
                let hotspot_bottom = pos.y + hotspot_h;

                let in_hotspot = cursor.x >= hotspot_left
                    && cursor.x <= hotspot_right
                    && cursor.y >= hotspot_top
                    && cursor.y <= hotspot_bottom;

                let was_in_hotspot = LOCK_MONITOR_IN_HOTSPOT.load(Ordering::SeqCst);

                if in_hotspot && !was_in_hotspot {
                    LOCK_MONITOR_IN_HOTSPOT.store(true, Ordering::SeqCst);
                    if PRACTICE_LOCKED.load(Ordering::SeqCst) {
                        set_click_through(&window, false);
                    }
                } else if !in_hotspot && was_in_hotspot {
                    LOCK_MONITOR_IN_HOTSPOT.store(false, Ordering::SeqCst);
                    if PRACTICE_LOCKED.load(Ordering::SeqCst) {
                        set_click_through(&window, true);
                    }
                }

                let mouse_state = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 };
                let mouse_is_down = mouse_state & 0x8000 != 0;
                let mouse_was_pressed = mouse_state & 0x0001 != 0;
                if in_hotspot && ((mouse_is_down && !mouse_was_down) || mouse_was_pressed) {
                    let next = !PRACTICE_LOCKED.load(Ordering::SeqCst);
                    apply_practice_lock(&window, next);
                }
                mouse_was_down = mouse_is_down;

                std::thread::sleep(std::time::Duration::from_millis(4));
            }
        }
    });

    locked
}

#[tauri::command]
fn stop_lock_monitor(window: tauri::Window) {
    LOCK_MONITOR_ACTIVE.store(false, Ordering::SeqCst);
    LOCK_MONITOR_GENERATION.fetch_add(1, Ordering::SeqCst);
    LOCK_MONITOR_IN_HOTSPOT.store(false, Ordering::SeqCst);
    PRACTICE_LOCKED.store(false, Ordering::SeqCst);
    set_click_through(&window, false);
}

use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};

static THUMBNAIL_LIMIT: once_cell::sync::Lazy<Arc<tokio::sync::Semaphore>> =
    once_cell::sync::Lazy::new(|| Arc::new(tokio::sync::Semaphore::new(2)));

#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageConfig {
    library_path: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryFile {
    path: String,
    thumbnail_path: Option<String>,
    relative_path: String,
    file_name: String,
    file_size: u64,
    modified_at: u64,
    pixel_width: u32,
    pixel_height: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryStatus {
    library_path: String,
    tagger_path: String,
    python_version: Option<String>,
    tagging_ready: bool,
    tagging_error: Option<String>,
    localization_ready: bool,
}

fn get_storage_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("storage_config.json"))
}

fn load_storage_config(app: &tauri::AppHandle) -> Result<StorageConfig, String> {
    let path = get_storage_config_path(app)?;
    if !path.exists() {
        return Ok(StorageConfig::default());
    }
    let data = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&data).map_err(|error| format!("存储目录配置损坏：{error}"))
}

fn save_storage_config(app: &tauri::AppHandle, config: &StorageConfig) -> Result<(), String> {
    let path = get_storage_config_path(app)?;
    let data = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, data).map_err(|error| error.to_string())
}

fn default_library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("library"))
        .map_err(|error| error.to_string())
}

fn get_tagger_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| "无法确定软件所在目录".to_string())?;
    let path = executable_dir.join("model").join("tagger-component");
    Ok(path)
}

fn python_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = get_tagger_dir(app)
        .map(|root| {
            vec![
                root.join("runtime/windows/python.exe"),
                root.join("tagger-runtime/windows/python.exe"),
                root.join("python.exe"),
            ]
        })
        .unwrap_or_default();
    if let Ok(configured) = std::env::var("FOCUS_SKETCH_PYTHON") {
        candidates.push(PathBuf::from(configured));
    }
    #[cfg(debug_assertions)]
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("assets/tagger-runtime/windows/python.exe"));
        candidates.push(current_dir.join(".venv/Scripts/python.exe"));
        candidates.push(current_dir.join(".venv/bin/python"));
    }
    candidates
}

fn find_tagging_python(app: &tauri::AppHandle) -> Result<(PathBuf, String), String> {
    let mut errors = Vec::new();
    for candidate in python_candidates(app) {
        let version = hidden_command(&candidate).arg("--version").output();
        let Ok(version) = version else {
            continue;
        };
        if !version.status.success() {
            continue;
        }
        let version_text = if version.stdout.is_empty() {
            String::from_utf8_lossy(&version.stderr).trim().to_string()
        } else {
            String::from_utf8_lossy(&version.stdout).trim().to_string()
        };
        let dependencies = hidden_command(&candidate)
            .args(["-c", "import onnxruntime, PIL, numpy"])
            .output();
        match dependencies {
            Ok(output) if output.status.success() => return Ok((candidate, version_text)),
            Ok(output) => errors.push(
                String::from_utf8_lossy(&output.stderr)
                    .lines()
                    .last()
                    .unwrap_or("模型依赖不完整")
                    .to_string(),
            ),
            Err(error) => errors.push(error.to_string()),
        }
    }
    Err(errors
        .last()
        .cloned()
        .unwrap_or_else(|| "未找到可用的 Python 解释器".to_string()))
}

fn hidden_command(program: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn tagging_runtime_installed(app: &tauri::AppHandle) -> bool {
    python_candidates(app)
        .into_iter()
        .any(|path| path.is_file())
}

fn find_tagging_model(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = get_tagger_dir(app)?;
    let candidates = vec![
        root.join("model/photo_tagger_visual_fp16_v1"),
        root.join("photo_tagger_visual_fp16_v1"),
        root.clone(),
    ];
    #[cfg(debug_assertions)]
    let candidates = {
        let mut candidates = candidates;
        if let Ok(current_dir) = std::env::current_dir() {
            candidates.push(current_dir.join("assets/model/photo_tagger_visual_fp16_v1"));
        }
        candidates
    };
    candidates
        .into_iter()
        .find(|path| {
            path.join("onnx_offline_cli.py").exists()
                && path.join("models/photo_tagger.nativefp16.onnx").exists()
        })
        .ok_or_else(|| "自动打标模型未安装".to_string())
}

fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp"
            )
        })
        .unwrap_or(false)
}

fn get_library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = load_storage_config(app)?;
    let path = config
        .library_path
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| default_library_dir(app))?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|error| error.to_string())?;
    Ok(path)
}

fn normalize_directory(path: String) -> Result<PathBuf, String> {
    let directory = PathBuf::from(path);
    if directory.as_os_str().is_empty() {
        return Err("目录不能为空".to_string());
    }
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建目录：{error}"))?;
    directory
        .canonicalize()
        .map_err(|error| format!("无法读取目录：{error}"))
}

#[tauri::command]
fn set_library_directory(app: tauri::AppHandle, path: String) -> Result<LibraryStatus, String> {
    let directory = normalize_directory(path)?;
    let mut config = load_storage_config(&app)?;
    config.library_path = Some(directory.to_string_lossy().to_string());
    save_storage_config(&app, &config)?;
    app.asset_protocol_scope()
        .allow_directory(&directory, true)
        .map_err(|error| error.to_string())?;
    get_library_status(app)
}

fn collect_images(path: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if path.is_file() {
        if is_supported_image(path) {
            output.push(path.to_path_buf());
        }
        return Ok(());
    }
    if !path.is_dir() {
        return Ok(());
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if entry.file_name() == ".thumbnails" {
                continue;
            }
            collect_images(&entry_path, output)?;
        } else if file_type.is_file() && is_supported_image(&entry_path) {
            output.push(entry_path);
        }
    }
    Ok(())
}

fn thumbnail_path_for(path: &Path, library_dir: &Path) -> PathBuf {
    let relative = path.strip_prefix(library_dir).unwrap_or(path);
    let mut thumbnail = library_dir.join(".thumbnails").join(relative);
    let thumbnail_name = format!(
        "{}.thumb.jpg",
        thumbnail.file_name().unwrap_or_default().to_string_lossy()
    );
    thumbnail.set_file_name(thumbnail_name);
    thumbnail
}

fn ensure_thumbnail(path: &Path, library_dir: &Path) -> Result<PathBuf, String> {
    let thumbnail_path = thumbnail_path_for(path, library_dir);
    let source_modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| error.to_string())?;
    let thumbnail_is_current = fs::metadata(&thumbnail_path)
        .and_then(|metadata| metadata.modified())
        .map(|modified| modified >= source_modified)
        .unwrap_or(false);
    if thumbnail_is_current {
        return Ok(thumbnail_path);
    }

    if let Some(parent) = thumbnail_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let source = image::open(path)
        .map_err(|error| format!("无法生成 {} 的缩略图：{error}", path.display()))?;
    let thumbnail = source.thumbnail(512, 512).to_rgb8();
    let output = fs::File::create(&thumbnail_path)
        .map_err(|error| format!("无法创建 {}：{error}", thumbnail_path.display()))?;
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(BufWriter::new(output), 82);
    encoder
        .encode_image(&thumbnail)
        .map_err(|error| format!("无法保存 {} 的缩略图：{error}", path.display()))?;
    Ok(thumbnail_path)
}

fn current_thumbnail(path: &Path, library_dir: &Path) -> Option<PathBuf> {
    let thumbnail_path = thumbnail_path_for(path, library_dir);
    let source_modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()?;
    let thumbnail_modified = fs::metadata(&thumbnail_path)
        .and_then(|metadata| metadata.modified())
        .ok()?;
    (thumbnail_modified >= source_modified).then_some(thumbnail_path)
}

fn library_file(path: &Path, library_dir: &Path) -> Result<LibraryFile, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let (pixel_width, pixel_height) = image::image_dimensions(path).unwrap_or((0, 0));
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    Ok(LibraryFile {
        path: path.to_string_lossy().to_string(),
        thumbnail_path: current_thumbnail(path, library_dir)
            .map(|thumbnail| thumbnail.to_string_lossy().to_string()),
        relative_path: path
            .strip_prefix(library_dir)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"),
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        file_size: metadata.len(),
        modified_at,
        pixel_width,
        pixel_height,
    })
}

fn scan_library_files(app: &tauri::AppHandle) -> Result<Vec<LibraryFile>, String> {
    let library_dir = get_library_dir(app)?;
    let mut paths = Vec::new();
    collect_images(&library_dir, &mut paths)?;
    paths.sort();
    paths
        .iter()
        .map(|path| library_file(path, &library_dir))
        .collect()
}

#[tauri::command]
async fn scan_library(app: tauri::AppHandle) -> Result<Vec<LibraryFile>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_library_files(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn count_library_images(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library_dir = get_library_dir(&app)?;
        let mut paths = Vec::new();
        collect_images(&library_dir, &mut paths)?;
        Ok(paths.len())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_library_thumbnail(
    app: tauri::AppHandle,
    image_path: String,
) -> Result<String, String> {
    let permit = THUMBNAIL_LIMIT
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let library_dir = get_library_dir(&app)?
            .canonicalize()
            .map_err(|error| format!("无法读取图库目录：{error}"))?;
        let image = PathBuf::from(image_path)
            .canonicalize()
            .map_err(|error| format!("无法读取图片：{error}"))?;
        if !image.starts_with(&library_dir) || !image.is_file() || !is_supported_image(&image) {
            return Err("只能为当前图库中的图片生成缩略图".to_string());
        }
        ensure_thumbnail(&image, &library_dir)
            .map(|thumbnail| thumbnail.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn remove_library_image(app: tauri::AppHandle, image_path: String) -> Result<(), String> {
    let library_dir = get_library_dir(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取图库目录：{error}"))?;
    let image = PathBuf::from(&image_path)
        .canonicalize()
        .map_err(|error| format!("无法读取待删除图片：{error}"))?;
    if !image.starts_with(&library_dir) || !image.is_file() || !is_supported_image(&image) {
        return Err("只能移除应用图库目录中的图片文件".to_string());
    }
    let thumbnail = thumbnail_path_for(&image, &library_dir);
    fs::remove_file(&image).map_err(|error| format!("移除图片失败：{error}"))?;
    let _ = fs::remove_file(thumbnail);
    Ok(())
}

fn import_library_files(
    app: &tauri::AppHandle,
    source_paths: Vec<String>,
) -> Result<Vec<LibraryFile>, String> {
    let library_dir = get_library_dir(app)?;
    let mut imported = Vec::new();
    for source_path in source_paths {
        let root = PathBuf::from(source_path);
        let mut sources = Vec::new();
        collect_images(&root, &mut sources)?;
        let pack_root = root.is_dir().then(|| {
            library_dir.join(
                root.file_name()
                    .unwrap_or_else(|| std::ffi::OsStr::new("图包")),
            )
        });

        for source in sources {
            let destination = if let Some(pack_root) = &pack_root {
                let relative = source
                    .strip_prefix(&root)
                    .unwrap_or_else(|_| Path::new(source.file_name().unwrap_or_default()));
                pack_root.join(relative)
            } else {
                library_dir.join(
                    source
                        .file_name()
                        .ok_or_else(|| format!("无法读取文件名: {}", source.display()))?,
                )
            };
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            if source != destination {
                fs::copy(&source, &destination)
                    .map_err(|error| format!("导入 {} 失败: {error}", source.display()))?;
            }
            imported.push(library_file(&destination, &library_dir)?);
        }
    }
    Ok(imported)
}

#[tauri::command]
async fn import_library_paths(
    app: tauri::AppHandle,
    source_paths: Vec<String>,
) -> Result<Vec<LibraryFile>, String> {
    tauri::async_runtime::spawn_blocking(move || import_library_files(&app, source_paths))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_library_folder(app: tauri::AppHandle) -> Result<(), String> {
    let library_dir = get_library_dir(&app)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(library_dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_tagger_folder(app: tauri::AppHandle) -> Result<(), String> {
    let tagger_dir = get_tagger_dir(&app)?;
    fs::create_dir_all(&tagger_dir).map_err(|error| format!("无法创建组件目录：{error}"))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(tagger_dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_library_status(app: tauri::AppHandle) -> Result<LibraryStatus, String> {
    let library_dir = get_library_dir(&app)?;
    let tagger_dir = get_tagger_dir(&app)?;
    let tagging_model = find_tagging_model(&app);
    let runtime_installed = tagging_runtime_installed(&app);
    let tagging_error = tagging_model.err().or_else(|| {
        (!runtime_installed)
            .then(|| "未找到自动打标运行时，请放入 runtime/windows/python.exe".to_string())
    });
    Ok(LibraryStatus {
        library_path: library_dir.to_string_lossy().to_string(),
        tagger_path: tagger_dir.to_string_lossy().to_string(),
        python_version: None,
        tagging_ready: tagging_error.is_none(),
        tagging_error,
        localization_ready: true,
    })
}

fn get_data_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|mut path| {
            if !path.exists() {
                fs::create_dir_all(&path).ok();
            }
            path.push("app_data.json");
            path
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_data(app: tauri::AppHandle) -> Result<String, String> {
    let path = get_data_file_path(&app)?;
    if path.exists() {
        fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn write_data(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = get_data_file_path(&app)?;
    fs::write(path, data).map_err(|e| e.to_string())
}

use std::io::{BufRead, BufReader};
use std::process::Stdio;
use tauri::ipc::Channel;

#[tauri::command]
async fn auto_tag_images(
    app: tauri::AppHandle,
    image_paths: Vec<String>,
    on_progress: Channel<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let temp_dir = std::env::temp_dir().join(format!(
        "etude_tagging_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;

    // Copy images to a temporary directory for processing
    let mut batch_paths = Vec::new();
    for (i, path) in image_paths.iter().enumerate() {
        let ext = Path::new(path).extension().unwrap_or_default();
        let temp_path = temp_dir.join(format!("{:08}.{}", i, ext.to_string_lossy()));
        if let Err(e) = fs::copy(path, &temp_path) {
            return Err(format!("Failed to copy image to temp dir: {}", e));
        }
        batch_paths.push(temp_path.to_string_lossy().to_string());
    }

    let model_dir = find_tagging_model(&app)?;
    let cli_script = model_dir.join("onnx_offline_cli.py");
    let output_dir = temp_dir.join("output");

    let (python, _) = find_tagging_python(&app)
        .map_err(|error| format!("打标环境不可用：{error}。图片已保留在图库中。"))?;
    let mut cmd = hidden_command(&python);
    cmd.arg(cli_script)
        .arg("--input")
        .arg(&temp_dir)
        .arg("--output")
        .arg(&output_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn python: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法读取打标进程输出")?;
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        if let Ok(l) = line {
            if let Ok(progress) = serde_json::from_str::<serde_json::Value>(&l) {
                if progress.get("type").and_then(|t| t.as_str()) == Some("progress") {
                    let _ = on_progress.send(progress);
                }
            }
        }
    }

    let stderr = child
        .stderr
        .take()
        .map(|stderr| {
            let mut reader = BufReader::new(stderr);
            let mut message = String::new();
            let _ = std::io::Read::read_to_string(&mut reader, &mut message);
            message
        })
        .unwrap_or_default();
    let status = child.wait().map_err(|e| format!("打标进程异常: {}", e))?;
    if !status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        let detail = stderr.lines().last().unwrap_or("未知错误");
        return Err(format!(
            "内置打标组件运行失败：{detail}。图片已保留在图库中，可在设置中检查模型资源。"
        ));
    }

    let results_json = fs::read_to_string(output_dir.join("results.json"))
        .map_err(|e| format!("Failed to read results: {}", e))?;

    let _ = fs::remove_dir_all(&temp_dir);

    let parsed: Vec<serde_json::Value> = serde_json::from_str(&results_json)
        .map_err(|e| format!("Failed to parse results: {}", e))?;

    Ok(parsed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_native_drag,
            set_window_click_through,
            read_data,
            write_data,
            scan_library,
            count_library_images,
            get_library_thumbnail,
            remove_library_image,
            import_library_paths,
            open_library_folder,
            open_tagger_folder,
            set_library_directory,
            get_library_status,
            auto_tag_images,
            start_lock_monitor,
            stop_lock_monitor,
            set_practice_locked,
            toggle_practice_locked
        ])
        .setup(|app| {
            let _ = get_library_dir(app.handle());
            let _ = get_tagger_dir(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
