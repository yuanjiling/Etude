fn main() {
    let mut config = tauri_build::Attributes::new();
    config = config.windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest")),
    );
    tauri_build::try_build(config).expect("failed to run tauri-build");
}
