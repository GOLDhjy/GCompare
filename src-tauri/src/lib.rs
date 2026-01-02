use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, Submenu, HELP_SUBMENU_ID},
    webview::PageLoadEvent,
    Emitter, Manager,
};
use tauri_plugin_log::{log, Builder as LogBuilder, RotationStrategy};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHistoryEntry {
    hash: String,
    timestamp: i64,
    author: String,
    summary: String,
    path: String,
    deleted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHistoryResult {
    repo_root: String,
    relative_path: String,
    entries: Vec<GitHistoryEntry>,
}

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn update_theme_menu(app: tauri::AppHandle, theme: String) {
    let menu = app
        .menu()
        .or_else(|| app.get_webview_window("main").and_then(|window| window.menu()));

    if let Some(menu) = menu {
        for id in ["theme_system", "theme_light", "theme_dark"] {
            if let Some(item) = menu.get(id) {
                if let Some(check_item) = item.as_check_menuitem() {
                    let _ = check_item.set_checked(false);
                }
            }
        }

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

fn run_git(args: &[String], cwd: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git is not installed or not available on PATH.".to_string()
            } else {
                format!("Failed to run git: {error}")
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let fallback = format!("git exited with status {}", output.status);
        return Err(if stderr.is_empty() { fallback } else { stderr });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_commit_line(line: &str) -> Option<(String, i64, String, String)> {
    let mut parts = line.splitn(4, '\t');
    let hash = parts.next()?;
    let timestamp = parts.next()?.parse::<i64>().ok()?;
    let author = parts.next()?.to_string();
    let summary = parts.next().unwrap_or("").to_string();
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((hash.to_string(), timestamp, author, summary))
}

fn to_git_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[tauri::command]
fn git_history(path: String) -> Result<GitHistoryResult, String> {
    let file_path = PathBuf::from(path);
    let parent = file_path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;

    let repo_root_output =
        run_git(&vec!["rev-parse".into(), "--show-toplevel".into()], parent)?;
    let repo_root_line = repo_root_output
        .lines()
        .next()
        .ok_or_else(|| "Unable to resolve repository root.".to_string())?;
    let repo_root = PathBuf::from(repo_root_line.trim());
    if repo_root.as_os_str().is_empty() {
        return Err("Unable to resolve repository root.".to_string());
    }

    let relative_path = file_path
        .strip_prefix(&repo_root)
        .map_err(|_| "File is not inside the repository.".to_string())?;
    let relative_path = to_git_path(relative_path);

    run_git(
        &vec![
            "ls-files".into(),
            "--error-unmatch".into(),
            "--".into(),
            relative_path.clone(),
        ],
        &repo_root,
    )
    .map_err(|_| "File is not tracked in git.".to_string())?;

    let log_output = run_git(
        &vec![
            "--no-pager".into(),
            "log".into(),
            "--follow".into(),
            "--name-status".into(),
            "--format=%H\t%ct\t%an\t%s".into(),
            "--".into(),
            relative_path.clone(),
        ],
        &repo_root,
    )?;

    let mut entries = Vec::new();
    let mut current_path = relative_path.clone();
    let mut last_entry_index: Option<usize> = None;

    for line in log_output.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Some((hash, timestamp, author, summary)) = parse_commit_line(line) {
            entries.push(GitHistoryEntry {
                hash,
                timestamp,
                author,
                summary,
                path: current_path.clone(),
                deleted: false,
            });
            last_entry_index = Some(entries.len() - 1);
            continue;
        }

        let mut parts = line.split('\t');
        let status = parts.next().unwrap_or("");

        if let Some(index) = last_entry_index {
            if status.starts_with('D') {
                if let Some(entry) = entries.get_mut(index) {
                    entry.deleted = true;
                }
            }
        }

        if status.starts_with('R') {
            let old_path = parts.next().unwrap_or("").to_string();
            let new_path = parts.next().unwrap_or("").to_string();
            if !old_path.is_empty() && !new_path.is_empty() && new_path == current_path {
                current_path = old_path;
            }
        }
    }

    Ok(GitHistoryResult {
        repo_root: repo_root.to_string_lossy().to_string(),
        relative_path,
        entries,
    })
}

#[tauri::command]
fn git_show_file(repo_root: String, commit: String, path: String) -> Result<String, String> {
    let repo_root = PathBuf::from(repo_root);
    if !repo_root.is_dir() {
        return Err("Repository root does not exist.".to_string());
    }
    let path = path.replace('\\', "/");
    let spec = format!("{commit}:{path}");
    run_git(
        &vec!["--no-pager".into(), "show".into(), spec],
        &repo_root,
    )
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

            let theme_menu = Submenu::with_id_and_items(
                app,
                "theme",
                "Theme",
                true,
                &[
                    &CheckMenuItem::with_id(
                        app,
                        "theme_system",
                        "System",
                        true,
                        true,
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "theme_light",
                        "Light",
                        true,
                        false,
                        None::<&str>,
                    )?,
                    &CheckMenuItem::with_id(
                        app,
                        "theme_dark",
                        "Dark",
                        true,
                        false,
                        None::<&str>,
                    )?,
                ],
            )?;
            let items = menu.items()?;
            let help_index = items
                .iter()
                .position(|item| item.id() == HELP_SUBMENU_ID);
            if let Some(index) = help_index {
                menu.insert(&theme_menu, index)?;
            } else {
                menu.append(&theme_menu)?;
            }

            if let Some(tauri::menu::MenuItemKind::Submenu(help_submenu)) =
                menu.get(HELP_SUBMENU_ID)
            {
                if help_submenu.get("check_updates").is_none() {
                    help_submenu.append(&MenuItem::with_id(
                        app,
                        "check_updates",
                        "Check for Updates...",
                        true,
                        None::<&str>,
                    )?)?;
                }
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
                    let _ = update_theme_menu(app.clone(), "system".to_string());
                }
                "theme_light" => {
                    let _ = app.emit("gcompare://set-theme", "light");
                    let _ = update_theme_menu(app.clone(), "light".to_string());
                }
                "theme_dark" => {
                    let _ = app.emit("gcompare://set-theme", "dark");
                    let _ = update_theme_menu(app.clone(), "dark".to_string());
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
        .invoke_handler(tauri::generate_handler![
            greet,
            update_theme_menu,
            consume_open_paths,
            git_history,
            git_show_file
        ])
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
