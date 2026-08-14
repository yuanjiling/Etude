#![windows_subsystem = "windows"]

use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "windows")]
use windows::core::HSTRING;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, MB_ICONINFORMATION, MB_ICONQUESTION, MB_OK, MB_YESNO, IDYES,
};

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn show_msg_box(text: &str, title: &str, is_question: bool) -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        let flags = if is_question {
            MB_YESNO | MB_ICONQUESTION
        } else {
            MB_OK | MB_ICONINFORMATION
        };
        let res = MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from(title),
            flags,
        );
        res == IDYES
    }
    #[cfg(not(target_os = "windows"))]
    {
        println!("{}: {}", title, text);
        true
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let is_in_temp = args.iter().any(|a| a == "--from-temp");

    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };

    // If running inside app directory, clone self to %TEMP% so app directory can be fully deleted
    if !is_in_temp {
        let app_dir = match current_exe.parent() {
            Some(p) => p.to_path_buf(),
            None => return,
        };

        let temp_dir = std::env::temp_dir();
        let temp_uninstaller = temp_dir.join("etude_uninstaller.exe");

        // Copy self to temp
        let _ = std::fs::copy(&current_exe, &temp_uninstaller);

        // Launch temp uninstaller with target directory argument
        let _ = Command::new(&temp_uninstaller)
            .args(["--from-temp", "--target", &app_dir.to_string_lossy()])
            .spawn();

        // Exit immediately so original Uninstall.exe is not locked!
        return;
    }

    // --- Running from %TEMP% ---

    // Extract target app directory
    let mut target_dir = PathBuf::new();
    for i in 0..args.len() {
        if args[i] == "--target" && i + 1 < args.len() {
            target_dir = PathBuf::from(&args[i + 1]);
            break;
        }
    }

    if target_dir.as_os_str().is_empty() {
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            target_dir = PathBuf::from(user_profile).join("AppData\\Local\\Programs\\Etude");
        }
    }

    // 1. Ask for confirmation
    let confirmed = show_msg_box(
        "确定要完全卸载 画谱 (Etude) 吗？\n\n该操作将移除所有程序组件与快捷方式。",
        "画谱 卸载程序",
        true,
    );

    if !confirmed {
        return;
    }

    // 2. Kill running processes
    let _ = hidden_command("taskkill")
        .args(["/F", "/IM", "Etude.exe", "/T"])
        .output();
    let _ = hidden_command("taskkill")
        .args(["/F", "/IM", "etude.exe", "/T"])
        .output();

    std::thread::sleep(std::time::Duration::from_millis(500));

    // 3. Remove Desktop Shortcut
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let desktop_link = PathBuf::from(user_profile).join("Desktop").join("画谱.lnk");
        let _ = std::fs::remove_file(desktop_link);
    }

    // 4. Remove Start Menu folder
    if let Ok(app_data) = std::env::var("APPDATA") {
        let start_menu = PathBuf::from(app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("画谱");
        let _ = std::fs::remove_dir_all(start_menu);
    }

    // 5. Remove Registry Entry
    let script = "Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Etude' -Recurse -Force -ErrorAction SilentlyContinue";
    let _ = hidden_command("powershell")
        .args(["-NoProfile", "-Command", script])
        .output();

    // 6. Delete the entire app directory (100% clean, zero locked files!)
    if target_dir.exists() {
        let _ = std::fs::remove_dir_all(&target_dir);
    }

    // Fallback cleanup command in case of slow file release
    if target_dir.exists() {
        let target_str = target_dir.to_string_lossy().to_string();
        let _ = hidden_command("cmd")
            .args(["/c", &format!("timeout /t 1 /nobreak >nul & rmdir /s /q \"{}\"", target_str)])
            .spawn();
    }

    // 7. Show success message
    show_msg_box(
        "画谱 (Etude) 已成功从您的电脑中卸载。",
        "卸载完成",
        false,
    );
}
