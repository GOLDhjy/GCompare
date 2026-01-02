use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::{
    menu::{Menu, MenuItem, Submenu, CheckMenuItem, HELP_SUBMENU_ID},
    webview::PageLoadEvent,
    Emitter, Manager,
};
use tauri_plugin_log::{log, Builder as LogBuilder, RotationStrategy};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn update_theme_menu(app: tauri::AppHandle, theme: String) {
    if let Some(window) = app.get_webview_window("main") {
        if let Some(menu) = window.menu() {
            // 取消所有主题菜单项的选中状态
            for id in ["theme_system", "theme_light", "theme_dark"] {
                if let Some(item) = menu.get(id) {
                    if let Some(check_item) = item.as_check_menuitem() {
                        let _ = check_item.set_checked(false);
                    }
                }
            }

            // 选中当前主题菜单项
            let menu_id = match theme.as_str() {
                "system" => "theme_system",
                "light" => "theme_light",
                "dark" => "theme_dark",
                _ => "theme_system",
            };

            if let Some(item) = menu.get(menu_id) {
                if let Some(check_item) = item.as_check_menuitem() {
                    let _ = check_item.set_checked(true);
                }
            }
        }
    }
}

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

fn collect_cli_paths(args: Vec<String>) -> Vec<String> {
    let exe_path = std::env::current_exe().ok();
    args.into_iter()
        .filter_map(|arg| {
            let path = PathBuf::from(&arg);
            if path.is_file() {
                if let Some(exe) = exe_path.as_ref() {
                    if *exe == path {
                        return None;
                    }
                }
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

fn append_boot_log(message: &str) {
    let path = std::env::temp_dir().join("gcompare-boot.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let _ = writeln!(file, "{ts} {message}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start = Arc::new(Instant::now());
    append_boot_log("boot start");

    let log_plugin = LogBuilder::new()
        .rotation_strategy(RotationStrategy::KeepAll)
        .build();

    let store_plugin = tauri_plugin_store::Builder::new().build();

    let app = tauri::Builder::default()
        .on_page_load({
            let start = Arc::clone(&start);
            move |_, payload| {
                let elapsed = start.elapsed().as_millis();
                let event = match payload.event() {
                    PageLoadEvent::Started => "page load started",
                    PageLoadEvent::Finished => "page load finished",
                };
                let url = payload.url();
                append_boot_log(&format!("{event} at {elapsed}ms url={url}"));
                log::info!("{event} {url}");
            }
        })
        .plugin(log_plugin)
        .plugin(store_plugin)
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let paths = collect_cli_paths(argv);
            if !paths.is_empty() {
                let state = app.state::<PendingOpenPaths>();
                let mut pending = state.0.lock().expect("pending open paths lock");
                pending.extend(paths.clone());
                let _ = app.emit("gcompare://open-files", paths);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(|app| {
            let menu = Menu::default(app)?;

            // 创建主题子菜单
            let theme_menu = Submenu::with_id_and_items(
                app,
                "theme",
                "主题",
                true,
                &[
                    &CheckMenuItem::with_id(
                        app,
                        "theme_system",
                        "跟随系统",
                        true,
                        true,  // 默认选中
                        None::<&str>
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "theme_light",
                        "亮色",
                        true,
                        false,
                        None::<&str>
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "theme_dark",
                        "深色",
                        true,
                        false,
                        None::<&str>
                    )?,
                ]
            )?;
            menu.append(&theme_menu)?;

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
            match event.id().as_ref() {
                "theme_system" => {
                    let _ = app.emit("gcompare://set-theme", "system");
                }
                "theme_light" => {
                    let _ = app.emit("gcompare://set-theme", "light");
                }
                "theme_dark" => {
                    let _ = app.emit("gcompare://set-theme", "dark");
                }
                "check_updates" => {
                    let _ = app.emit("gcompare://check-updates", ());
                }
                _ => {}
            }
        })
        .manage(PendingOpenPaths::default())
        .setup({
            let start = Arc::clone(&start);
            move |app| {
            log::info!("setup start");
            append_boot_log(&format!(
                "setup start at {}ms",
                start.elapsed().as_millis()
            ));
            let startup_paths = collect_startup_paths();
            if !startup_paths.is_empty() {
                let state = app.state::<PendingOpenPaths>();
                let mut pending = state.0.lock().expect("pending open paths lock");
                pending.extend(startup_paths);
            }
            log::info!("setup end");
            append_boot_log(&format!(
                "setup end at {}ms",
                start.elapsed().as_millis()
            ));
            Ok(())
        }
        })
        .invoke_handler(tauri::generate_handler![greet, update_theme_menu, consume_open_paths])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    append_boot_log(&format!(
        "builder build done at {}ms",
        start.elapsed().as_millis()
    ));

    app.run({
        let start = Arc::clone(&start);
        move |app_handle, event| {
        if let tauri::RunEvent::Ready = &event {
            append_boot_log(&format!(
                "run ready at {}ms",
                start.elapsed().as_millis()
            ));
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<String> = urls
                .iter()
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
    }
    });
}
