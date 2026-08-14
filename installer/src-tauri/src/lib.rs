use std::fs::{self, File};
use std::io::{self, Cursor};
use std::path::{Path, PathBuf};
use std::process::Command;

// Embedded payload zip generated during release build
const EMBEDDED_PAYLOAD: &[u8] = include_bytes!("../payload.zip");

#[tauri::command]
fn exit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn minimize_app(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn start_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn get_default_install_path() -> Result<String, String> {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let path = PathBuf::from(local_app_data).join("Programs").join("Etude");
        return Ok(path.to_string_lossy().to_string());
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let path = PathBuf::from(user_profile)
            .join("AppData")
            .join("Local")
            .join("Programs")
            .join("Etude");
        return Ok(path.to_string_lossy().to_string());
    }
    Ok("C:\\Program Files\\Etude".to_string())
}

#[tauri::command]
fn select_install_directory(default_path: Option<String>) -> Result<Option<String>, String> {
    let initial_dir = default_path.unwrap_or_else(|| "C:\\".to_string());
    
    // PowerShell folder browser dialog
    let script = format!(
        "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null; \
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
        $dialog.SelectedPath = '{}'; \
        $dialog.Description = '选择画谱 (Etude) 的安装目标文件夹'; \
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
            Write-Output $dialog.SelectedPath \
        }}",
        initial_dir.replace('\'', "''")
    );

    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("无法打开文件夹选择窗口: {}", e))?;

    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        Ok(None)
    } else {
        let path = PathBuf::from(&path_str);
        let final_path = if path.file_name().map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case("Etude")) {
            path
        } else {
            path.join("Etude")
        };
        Ok(Some(final_path.to_string_lossy().to_string()))
    }
}

#[tauri::command]
fn check_process_running() -> bool {
    let output = hidden_command("tasklist")
        .args(["/FI", "IMAGENAME eq Etude.exe", "/FO", "CSV", "/NH"])
        .output();

    if let Ok(out) = output {
        let content = String::from_utf8_lossy(&out.stdout).to_lowercase();
        return content.contains("etude.exe");
    }
    false
}

#[tauri::command]
fn kill_existing_process() -> Result<(), String> {
    let _ = hidden_command("taskkill")
        .args(["/F", "/IM", "Etude.exe"])
        .output();
    std::thread::sleep(std::time::Duration::from_millis(300));
    Ok(())
}

#[tauri::command]
fn perform_install(
    target_dir: String,
    create_desktop_shortcut: bool,
    create_start_menu_shortcut: bool,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&target_dir);

    // 1. Ensure any running Etude process is closed
    let _ = kill_existing_process();

    // 2. Create target directory
    fs::create_dir_all(&dest_path)
        .map_err(|e| format!("无法创建目标安装目录 ({}): {}", target_dir, e))?;

    // 3. Extract embedded payload zip
    extract_zip_payload(EMBEDDED_PAYLOAD, &dest_path)?;

    // 4. Create Uninstaller scripts
    create_uninstaller_scripts(&dest_path)?;

    // 5. Register in Windows Registry (Settings -> Installed Apps)
    register_windows_uninstall(&dest_path, "0.1.2")?;

    // 6. Create Desktop Shortcut
    let exe_path = dest_path.join("Etude.exe");
    if create_desktop_shortcut {
        if let Ok(desktop_dir) = get_desktop_dir() {
            let shortcut_path = desktop_dir.join("画谱.lnk");
            let _ = create_windows_shortcut(&exe_path, &dest_path, &shortcut_path, "画谱 · 桌面画板速写辅助工具");
        }
    }

    // 7. Create Start Menu Shortcuts
    if create_start_menu_shortcut {
        if let Ok(start_menu_dir) = get_start_menu_dir() {
            let _ = fs::create_dir_all(&start_menu_dir);
            let shortcut_path = start_menu_dir.join("画谱.lnk");
            let _ = create_windows_shortcut(&exe_path, &dest_path, &shortcut_path, "画谱 · 桌面画板速写辅助工具");

            let uninst_exe_path = dest_path.join("Uninstall.exe");
            let uninst_shortcut_path = start_menu_dir.join("卸载画谱.lnk");
            let _ = create_windows_shortcut(&uninst_exe_path, &dest_path, &uninst_shortcut_path, "卸载画谱 (Etude)");
        }
    }

    Ok(())
}

#[tauri::command]
fn launch_installed_app(target_dir: String) -> Result<(), String> {
    let exe_path = PathBuf::from(&target_dir).join("Etude.exe");
    if exe_path.exists() {
        let _ = Command::new(&exe_path)
            .current_dir(&target_dir)
            .spawn()
            .map_err(|e| format!("启动应用失败: {}", e))?;
    }
    std::process::exit(0);
}

// ---------------- Helper Functions ----------------

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn extract_zip_payload(payload_bytes: &[u8], dest: &Path) -> Result<(), String> {
    let reader = Cursor::new(payload_bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("解析安装包核心数据失败: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取压缩文件条目失败: {}", e))?;
        
        let outpath = match file.enclosed_name() {
            Some(path) => dest.join(path),
            None => continue,
        };

        if file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| format!("写入文件失败 ({}): {}", outpath.display(), e))?;
            io::copy(&mut file, &mut outfile).map_err(|e| format!("解压文件失败 ({}): {}", outpath.display(), e))?;
        }
    }
    Ok(())
}

fn get_desktop_dir() -> Result<PathBuf, String> {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let path = PathBuf::from(user_profile).join("Desktop");
        if path.exists() {
            return Ok(path);
        }
    }
    Err("无法定位桌面目录".to_string())
}

fn get_start_menu_dir() -> Result<PathBuf, String> {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let path = PathBuf::from(app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("画谱");
        return Ok(path);
    }
    Err("无法定位开始菜单目录".to_string())
}

fn create_windows_shortcut(
    target_exe: &Path,
    working_dir: &Path,
    shortcut_path: &Path,
    description: &str,
) -> Result<(), String> {
    let target_str = target_exe.to_string_lossy().replace('\'', "''");
    let work_str = working_dir.to_string_lossy().replace('\'', "''");
    let link_str = shortcut_path.to_string_lossy().replace('\'', "''");

    let script = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
        $Shortcut = $WshShell.CreateShortcut('{}'); \
        $Shortcut.TargetPath = '{}'; \
        $Shortcut.WorkingDirectory = '{}'; \
        $Shortcut.Description = '{}'; \
        $Shortcut.IconLocation = '{},0'; \
        $Shortcut.Save();",
        link_str, target_str, work_str, description, target_str
    );

    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("创建快捷方式失败: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn create_uninstaller_scripts(dest: &Path) -> Result<(), String> {
    let dest_str = dest.to_string_lossy().to_string();

    let ps1_content = format!(
        "# Etude Uninstaller\n\
        $ErrorActionPreference = 'SilentlyContinue'\n\
        Stop-Process -Name 'Etude' -Force -ErrorAction SilentlyContinue\n\
        Start-Sleep -Milliseconds 500\n\
        \n\
        # 1. Remove Desktop and Start Menu shortcuts\n\
        $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) '画谱.lnk'\n\
        Remove-Item -LiteralPath $desktopLink -Force -ErrorAction SilentlyContinue\n\
        \n\
        $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) '画谱'\n\
        Remove-Item -LiteralPath $startMenu -Recurse -Force -ErrorAction SilentlyContinue\n\
        \n\
        # 2. Remove Registry Entry\n\
        Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Etude' -Recurse -Force -ErrorAction SilentlyContinue\n\
        \n\
        # 3. Schedule directory cleanup\n\
        $appDir = '{0}'\n\
        Start-Process cmd.exe -ArgumentList '/c timeout /t 2 & rmdir /s /q \"'$appDir'\"' -WindowStyle Hidden\n\
        ",
        dest_str.replace('\'', "''")
    );

    let ps1_path = dest.join("uninstall.ps1");
    fs::write(&ps1_path, ps1_content).map_err(|e| e.to_string())?;

    let bat_content = format!(
        "@echo off\r\n\
        powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0uninstall.ps1\"\r\n\
        exit\r\n"
    );
    let bat_path = dest.join("uninstall.bat");
    fs::write(&bat_path, bat_content).map_err(|e| e.to_string())?;

    Ok(())
}

fn register_windows_uninstall(dest: &Path, version: &str) -> Result<(), String> {
    let dest_str = dest.to_string_lossy().replace('\'', "''");
    let exe_str = dest.join("Etude.exe").to_string_lossy().replace('\'', "''");
    let uninst_exe_str = dest.join("Uninstall.exe").to_string_lossy().replace('\'', "''");

    let script = format!(
        "$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Etude'; \
        if (!(Test-Path $regPath)) {{ New-Item -Path $regPath -Force | Out-Null }}; \
        Set-ItemProperty -Path $regPath -Name 'DisplayName' -Value '画谱 (Etude)' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'DisplayVersion' -Value '{}' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'Publisher' -Value 'Etude' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'DisplayIcon' -Value '{},0' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'InstallLocation' -Value '{}' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'UninstallString' -Value '\"{}\"' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'QuietUninstallString' -Value '\"{}\"' -Type String; \
        Set-ItemProperty -Path $regPath -Name 'EstimatedSize' -Value 46000 -Type DWord; \
        Set-ItemProperty -Path $regPath -Name 'NoModify' -Value 1 -Type DWord; \
        Set-ItemProperty -Path $regPath -Name 'NoRepair' -Value 1 -Type DWord;",
        version, exe_str, dest_str, uninst_exe_str, uninst_exe_str
    );

    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("写入系统注册表失败: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            exit_app,
            minimize_app,
            start_drag,
            get_default_install_path,
            select_install_directory,
            check_process_running,
            kill_existing_process,
            perform_install,
            launch_installed_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running etude installer");
}
