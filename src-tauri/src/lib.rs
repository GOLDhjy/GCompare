use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, Submenu, HELP_SUBMENU_ID},
    Emitter, Manager,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn consume_open_paths(state: tauri::State<PendingOpenPaths>) -> Vec<String> {
    let mut pending = state.0.lock().expect("pending open paths lock");
    let paths = pending.clone();
    pending.clear();
    paths
}

fn collect_startup_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let path = std::path::PathBuf::from(arg);
            if path.is_file() {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(|app| {
            let menu = Menu::default(app)?;
            if let Some(tauri::menu::MenuItemKind::Submenu(help_menu)) =
                menu.get(HELP_SUBMENU_ID)
            {
                help_menu.append(&MenuItem::with_id(
                    app,
                    "check_updates",
                    "Check for Updates...",
                    true,
                    None::<&str>,
                )?)?;
            } else {
                let help_menu = Submenu::with_id_and_items(
                    app,
                    HELP_SUBMENU_ID,
                    "Help",
                    true,
                    &[&MenuItem::with_id(
                        app,
                        "check_updates",
                        "Check for Updates...",
                        true,
                        None::<&str>,
                    )?],
                )?;
                menu.append(&help_menu)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == "check_updates" {
                let _ = app.emit("gcompare://check-updates", ());
            }
        })
        .manage(PendingOpenPaths::default())
        .setup(|app| {
            let startup_paths = collect_startup_paths();
            if !startup_paths.is_empty() {
                let state = app.state::<PendingOpenPaths>();
                let mut pending = state.0.lock().expect("pending open paths lock");
                pending.extend(startup_paths);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, consume_open_paths])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| path.is_file())
                .map(|path| path.to_string_lossy().to_string())
                .collect();

            if !paths.is_empty() {
                let state = app_handle.state::<PendingOpenPaths>();
                let mut pending = state.0.lock().expect("pending open paths lock");
                pending.extend(paths.clone());

                let _ = app_handle.emit("gcompare://open-files", paths);
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = app_handle;
            let _ = event;
        }
    });
}
