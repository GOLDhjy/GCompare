use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{
    menu::{
        CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
        HELP_SUBMENU_ID,
    },
    webview::PageLoadEvent,
    Emitter, Manager,
};
use tauri_plugin_log::{log, Builder as LogBuilder, RotationStrategy};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VcsHistoryEntry {
    provider: String,
    hash: String,
    timestamp: i64,
    author: String,
    summary: String,
    path: String,
    deleted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VcsHistoryResult {
    provider: String,
    repo_root: Option<String>,
    relative_path: String,
    entries: Vec<VcsHistoryEntry>,
}

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn update_theme_menu(app: tauri::AppHandle, theme: String) {
    let menu = app
        .menu()
        .or_else(|| app.get_webview_window("main").and_then(|window| window.menu()));

    if let Some(menu) = menu {
        let theme_submenu = match menu.get("theme") {
            Some(MenuItemKind::Submenu(submenu)) => Some(submenu),
            _ => None,
        };

        if let Some(theme_submenu) = theme_submenu {
            for id in ["theme_system", "theme_light", "theme_dark"] {
                if let Some(item) = theme_submenu.get(id) {
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

            if let Some(item) = theme_submenu.get(menu_id) {
                if let Some(check_item) = item.as_check_menuitem() {
                    let _ = check_item.set_checked(true);
                }
            }
        }
    }
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    tauri::process::restart(&app.env());
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
        let message = if stderr.is_empty() { fallback } else { stderr };
        log::warn!("git failed cwd={} args={args:?} error={message}", cwd.display());
        return Err(message);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_p4(args: &[String], cwd: &Path) -> Result<String, String> {
    let mut command = Command::new("p4");
    command.current_dir(cwd).args(args);
    let env_config = std::env::var("P4CONFIG")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let config_info = if env_config.is_some() {
        None
    } else {
        find_p4config_info(cwd)
    };
    if let Some(info) = &config_info {
        command.env("P4CONFIG", &info.name);
        log::info!(
            "P4CONFIG resolved name={} path={}",
            info.name,
            info.path.display()
        );
    } else if let Some(config) = &env_config {
        log::info!("P4CONFIG already set to {config}");
    } else {
        log::info!("P4CONFIG not set and no local config found from {}", cwd.display());
    }

    let output = command.output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "p4 is not installed or not available on PATH.".to_string()
        } else {
            format!("Failed to run p4: {error}")
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let fallback = format!("p4 exited with status {}", output.status);
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            fallback
        };
        log::warn!("p4 failed cwd={} args={args:?} error={message}", cwd.display());
        return Err(message);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_svn(args: &[String], cwd: &Path) -> Result<String, String> {
    let output = Command::new("svn")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "svn is not installed or not available on PATH.".to_string()
            } else {
                format!("Failed to run svn: {error}")
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let fallback = format!("svn exited with status {}", output.status);
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            fallback
        };
        log::warn!("svn failed cwd={} args={args:?} error={message}", cwd.display());
        return Err(message);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

struct P4ConfigInfo {
    name: String,
    path: PathBuf,
}

fn find_p4config_info(cwd: &Path) -> Option<P4ConfigInfo> {
    let candidates = ["p4config.txt", ".p4config", "p4config"];
    let mut current = Some(cwd);
    while let Some(dir) = current {
        for name in candidates {
            let path = dir.join(name);
            if path.is_file() {
                return Some(P4ConfigInfo {
                    name: name.to_string(),
                    path,
                });
            }
        }
        current = dir.parent();
    }
    None
}

fn truncate_for_log(value: &str, max_len: usize) -> String {
    let normalized = value.replace('\r', "").replace('\n', "\\n");
    if normalized.len() <= max_len {
        return normalized;
    }
    let mut truncated = normalized;
    truncated.truncate(max_len);
    truncated.push_str("...(truncated)");
    truncated
}

fn extract_xml_attr(line: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = line.find(&needle)? + needle.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_xml_value(line: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = line.find(&open)? + open.len();
    let end = line.find(&close)?;
    if end < start {
        return None;
    }
    Some(line[start..end].to_string())
}

fn parse_svn_time(value: &str) -> i64 {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(|dt| dt.unix_timestamp())
        .unwrap_or(0)
}

fn parse_svn_log_entries(output: &str, path: &str) -> Vec<VcsHistoryEntry> {
    struct PendingSvnEntry {
        revision: String,
        timestamp: i64,
        author: String,
        summary: String,
        deleted: bool,
    }

    let mut entries = Vec::new();
    let mut pending: Option<PendingSvnEntry> = None;
    let mut in_msg = false;
    let mut msg_lines: Vec<String> = Vec::new();

    for raw_line in output.lines() {
        let line = raw_line.trim();

        if line.starts_with("<logentry") {
            let revision = extract_xml_attr(line, "revision").unwrap_or_default();
            pending = Some(PendingSvnEntry {
                revision,
                timestamp: 0,
                author: String::new(),
                summary: String::new(),
                deleted: false,
            });
            in_msg = false;
            msg_lines.clear();
            continue;
        }

        if line.starts_with("</logentry") {
            if in_msg {
                if let Some(entry) = pending.as_mut() {
                    entry.summary = msg_lines.join("\n");
                }
                in_msg = false;
            }
            if let Some(entry) = pending.take() {
                if !entry.revision.is_empty() {
                    entries.push(VcsHistoryEntry {
                        provider: "svn".to_string(),
                        hash: entry.revision,
                        timestamp: entry.timestamp,
                        author: entry.author,
                        summary: entry.summary,
                        path: path.to_string(),
                        deleted: entry.deleted,
                    });
                }
            }
            continue;
        }

        let Some(entry) = pending.as_mut() else {
            continue;
        };

        if in_msg {
            if let Some(end_idx) = line.find("</msg>") {
                msg_lines.push(line[..end_idx].to_string());
                entry.summary = msg_lines.join("\n");
                msg_lines.clear();
                in_msg = false;
            } else {
                msg_lines.push(line.to_string());
            }
            continue;
        }

        if let Some(author) = extract_xml_value(line, "author") {
            entry.author = author;
            continue;
        }

        if let Some(date) = extract_xml_value(line, "date") {
            entry.timestamp = parse_svn_time(&date);
            continue;
        }

        if let Some(msg) = extract_xml_value(line, "msg") {
            entry.summary = msg;
            continue;
        }

        if line.contains("<msg>") {
            let start = line.find("<msg>").map(|idx| idx + 5).unwrap_or(0);
            let remainder = &line[start..];
            if let Some(end_idx) = remainder.find("</msg>") {
                entry.summary = remainder[..end_idx].to_string();
            } else {
                in_msg = true;
                msg_lines.push(remainder.to_string());
            }
            continue;
        }

        if line.contains("<path") && line.contains("action=\"D\"") {
            entry.deleted = true;
        }
    }

    entries
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

fn git_history_blocking(path: String) -> Result<GitHistoryResult, String> {
    let file_path = PathBuf::from(path);
    if !file_path.is_file() {
        return Err("Path is not a file.".to_string());
    }
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

    struct PendingCommit {
        hash: String,
        timestamp: i64,
        author: String,
        summary: String,
        path: String,
        deleted: bool,
        touched: bool,
    }

    let mut entries = Vec::new();
    let mut current_path = relative_path.clone();
    let mut pending: Option<PendingCommit> = None;

    let mut flush_pending = |pending: &mut Option<PendingCommit>| {
        if let Some(entry) = pending.take() {
            if entry.touched {
                entries.push(GitHistoryEntry {
                    hash: entry.hash,
                    timestamp: entry.timestamp,
                    author: entry.author,
                    summary: entry.summary,
                    path: entry.path,
                    deleted: entry.deleted,
                });
            }
        }
    };

    for line in log_output.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Some((hash, timestamp, author, summary)) = parse_commit_line(line) {
            flush_pending(&mut pending);
            pending = Some(PendingCommit {
                hash,
                timestamp,
                author,
                summary,
                path: current_path.clone(),
                deleted: false,
                touched: false,
            });
            continue;
        }

        let mut parts = line.split('\t');
        let status = parts.next().unwrap_or("");
        if status.is_empty() {
            continue;
        }

        let Some(entry) = pending.as_mut() else {
            continue;
        };

        if status.starts_with('R') || status.starts_with('C') {
            let old_path = parts.next().unwrap_or("");
            let new_path = parts.next().unwrap_or("");
            if !old_path.is_empty() && !new_path.is_empty() {
                if new_path == current_path || old_path == current_path {
                    entry.touched = true;
                }
                if status.starts_with('R') && new_path == current_path {
                    current_path = old_path.to_string();
                }
            }
        } else {
            let path = parts.next().unwrap_or("");
            if path == current_path {
                entry.touched = true;
                if status.starts_with('D') {
                    entry.deleted = true;
                }
            }
        }
    }

    flush_pending(&mut pending);

    Ok(GitHistoryResult {
        repo_root: repo_root.to_string_lossy().to_string(),
        relative_path,
        entries,
    })
}

fn git_show_file_blocking(repo_root: String, commit: String, path: String) -> Result<String, String> {
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

fn map_git_entry(entry: GitHistoryEntry) -> VcsHistoryEntry {
    VcsHistoryEntry {
        provider: "git".to_string(),
        hash: entry.hash,
        timestamp: entry.timestamp,
        author: entry.author,
        summary: entry.summary,
        path: entry.path,
        deleted: entry.deleted,
    }
}

fn map_git_result(result: GitHistoryResult) -> VcsHistoryResult {
    VcsHistoryResult {
        provider: "git".to_string(),
        repo_root: Some(result.repo_root),
        relative_path: result.relative_path,
        entries: result.entries.into_iter().map(map_git_entry).collect(),
    }
}

fn p4_history_blocking(path: String) -> Result<VcsHistoryResult, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("Path is not a file.".to_string());
    }
    let parent = file_path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;

    let log_output = run_p4(
        &vec![
            "-ztag".into(),
            "filelog".into(),
            "-t".into(),
            "-l".into(),
            path.clone(),
        ],
        parent,
    )?;

    struct PendingP4Entry {
        change: String,
        timestamp: i64,
        author: String,
        summary: String,
        path: String,
        deleted: bool,
    }

    let mut entries = Vec::new();
    let mut current_depot_path: Option<String> = None;
    let mut pending: Option<PendingP4Entry> = None;

    let mut flush_pending = |pending: &mut Option<PendingP4Entry>| {
        if let Some(entry) = pending.take() {
            entries.push(VcsHistoryEntry {
                provider: "p4".to_string(),
                hash: entry.change,
                timestamp: entry.timestamp,
                author: entry.author,
                summary: entry.summary,
                path: entry.path,
                deleted: entry.deleted,
            });
        }
    };

    for line in log_output.lines() {
        let trimmed = line.trim_end();
        let Some(rest) = trimmed.strip_prefix("... ") else {
            continue;
        };

        let mut parts = rest.splitn(2, ' ');
        let key = parts.next().unwrap_or("");
        let base_key = key
            .trim_end_matches(|c: char| c.is_ascii_digit() || c == ',')
            .trim();
        let value = parts.next().unwrap_or("").trim();

        match base_key {
            "depotFile" => {
                if !value.is_empty() {
                    current_depot_path = Some(value.to_string());
                }
            }
            "change" => {
                flush_pending(&mut pending);
                let entry_path = current_depot_path
                    .clone()
                    .unwrap_or_else(|| path.clone());
                pending = Some(PendingP4Entry {
                    change: value.to_string(),
                    timestamp: 0,
                    author: String::new(),
                    summary: String::new(),
                    path: entry_path,
                    deleted: false,
                });
            }
            "time" => {
                if let Some(entry) = pending.as_mut() {
                    entry.timestamp = value.parse::<i64>().unwrap_or(0);
                }
            }
            "user" => {
                if let Some(entry) = pending.as_mut() {
                    entry.author = value.to_string();
                }
            }
            "desc" => {
                if let Some(entry) = pending.as_mut() {
                    if entry.summary.is_empty() {
                        entry.summary = value.to_string();
                    }
                }
            }
            "action" => {
                if let Some(entry) = pending.as_mut() {
                    if value.contains("delete") {
                        entry.deleted = true;
                    }
                }
            }
            _ => {}
        }
    }

    flush_pending(&mut pending);

    let relative_path = current_depot_path.unwrap_or(path);
    if entries.is_empty() {
        if log_output.trim().is_empty() {
            log::warn!("p4 filelog returned empty output path={relative_path}");
        } else {
            let output_preview = truncate_for_log(&log_output, 4000);
            log::warn!(
                "p4 history parsed 0 entries path={relative_path} output_preview={output_preview}"
            );
        }
    }

    Ok(VcsHistoryResult {
        provider: "p4".to_string(),
        repo_root: None,
        relative_path,
        entries,
    })
}

fn svn_history_blocking(path: String) -> Result<VcsHistoryResult, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("Path is not a file.".to_string());
    }
    let parent = file_path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;

    let wc_root = run_svn(
        &vec![
            "info".into(),
            "--show-item".into(),
            "wc-root".into(),
            path.clone(),
        ],
        parent,
    )
    .ok()
    .and_then(|output| {
        output
            .lines()
            .next()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .map(PathBuf::from)
    });

    let relative_path = wc_root
        .as_ref()
        .and_then(|root| file_path.strip_prefix(root).ok())
        .map(to_git_path)
        .unwrap_or_else(|| fallback_relative_path(&path));

    let log_output = run_svn(
        &vec![
            "log".into(),
            "--xml".into(),
            "--verbose".into(),
            path.clone(),
        ],
        parent,
    )?;

    if log_output.trim().is_empty() {
        log::warn!("svn log returned empty output path={path}");
    }

    let entries = parse_svn_log_entries(&log_output, &relative_path);
    if entries.is_empty() {
        if log_output.trim().is_empty() {
            log::warn!("svn log returned empty output path={relative_path}");
        } else {
            let output_preview = truncate_for_log(&log_output, 4000);
            log::warn!(
                "svn history parsed 0 entries path={relative_path} output_preview={output_preview}"
            );
        }
    }

    Ok(VcsHistoryResult {
        provider: "svn".to_string(),
        repo_root: wc_root.map(|root| root.to_string_lossy().to_string()),
        relative_path,
        entries,
    })
}

fn is_git_no_history(error: &str) -> bool {
    let lower = error.to_lowercase();
    error == "git is not installed or not available on PATH."
        || error == "File is not inside the repository."
        || error == "File is not tracked in git."
        || error == "Unable to resolve repository root."
        || lower.contains("not a git repository")
        || lower.contains("not in a git directory")
}

fn is_p4_no_history(error: &str) -> bool {
    let lower = error.to_lowercase();
    error == "p4 is not installed or not available on PATH."
        || lower.contains("not under client's root")
        || lower.contains("not in client view")
        || lower.contains("not in client")
        || lower.contains("not on client")
        || lower.contains("no such file")
        || lower.contains("file(s) not in client")
        || lower.contains("must create client")
        || lower.contains("no such client")
        || (lower.contains("client") && lower.contains("unknown"))
        || (lower.contains("client") && lower.contains("not found"))
}

fn is_svn_no_history(error: &str) -> bool {
    let lower = error.to_lowercase();
    error == "svn is not installed or not available on PATH."
        || lower.contains("not a working copy")
        || lower.contains("not under version control")
        || lower.contains("is not a working copy")
        || lower.contains("e155007")
        || lower.contains("e155010")
        || lower.contains("no such file")
        || lower.contains("not found")
        || lower.contains("does not exist")
}

fn fallback_relative_path(path: &str) -> String {
    let file_path = PathBuf::from(path);
    file_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn empty_history(path: String) -> VcsHistoryResult {
    VcsHistoryResult {
        provider: "none".to_string(),
        repo_root: None,
        relative_path: fallback_relative_path(&path),
        entries: Vec::new(),
    }
}

fn vcs_history_blocking(path: String) -> Result<VcsHistoryResult, String> {
    log::info!("vcs_history requested path={path}");
    let git_error = match git_history_blocking(path.clone()) {
        Ok(result) => return Ok(map_git_result(result)),
        Err(error) => {
            if error == "Path is not a file." || error == "Invalid file path." {
                return Err(error);
            }
            log::warn!("Git history failed path={path} error={error}");
            error
        }
    };

    let p4_error = match p4_history_blocking(path.clone()) {
        Ok(result) => return Ok(result),
        Err(error) => {
            log::warn!("P4 history failed path={path} error={error}");
            error
        }
    };

    let svn_error = match svn_history_blocking(path.clone()) {
        Ok(result) => return Ok(result),
        Err(error) => {
            log::warn!("SVN history failed path={path} error={error}");
            error
        }
    };

    if is_git_no_history(&git_error)
        && is_p4_no_history(&p4_error)
        && is_svn_no_history(&svn_error)
    {
        log::info!(
            "No VCS history path={path} git_error={git_error} p4_error={p4_error} svn_error={svn_error}"
        );
        Ok(empty_history(path))
    } else {
        Err(format!(
            "Git history unavailable: {git_error}. P4 history unavailable: {p4_error}. SVN history unavailable: {svn_error}"
        ))
    }
}

fn p4_show_file_blocking(
    path: String,
    change: String,
    working_path: String,
) -> Result<String, String> {
    if change.is_empty() || !change.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid changelist.".to_string());
    }
    let spec = format!("{path}@={change}");
    let working_path = PathBuf::from(working_path);
    let cwd = working_path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;
    run_p4(&vec!["print".into(), "-q".into(), spec], cwd)
}

fn svn_show_file_blocking(revision: String, working_path: String) -> Result<String, String> {
    if revision.is_empty() || !revision.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid revision.".to_string());
    }
    let working_path = PathBuf::from(working_path);
    let cwd = working_path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;
    run_svn(
        &vec![
            "cat".into(),
            "-r".into(),
            revision,
            working_path.to_string_lossy().to_string(),
        ],
        cwd,
    )
}

#[tauri::command]
async fn git_history(path: String) -> Result<GitHistoryResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_history_blocking(path))
        .await
        .map_err(|error| format!("Git history task failed: {error}"))?
}

#[tauri::command]
async fn git_show_file(repo_root: String, commit: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_show_file_blocking(repo_root, commit, path)
    })
    .await
    .map_err(|error| format!("Git show task failed: {error}"))?
}

#[tauri::command]
async fn svn_history(path: String) -> Result<VcsHistoryResult, String> {
    tauri::async_runtime::spawn_blocking(move || svn_history_blocking(path))
        .await
        .map_err(|error| format!("SVN history task failed: {error}"))?
}

#[tauri::command]
async fn vcs_history(path: String) -> Result<VcsHistoryResult, String> {
    tauri::async_runtime::spawn_blocking(move || vcs_history_blocking(path))
        .await
        .map_err(|error| format!("History task failed: {error}"))?
}

#[tauri::command]
async fn p4_show_file(path: String, change: String, working_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        p4_show_file_blocking(path, change, working_path)
    })
    .await
    .map_err(|error| format!("P4 show task failed: {error}"))?
}

#[tauri::command]
async fn svn_show_file(revision: String, working_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        svn_show_file_blocking(revision, working_path)
    })
    .await
    .map_err(|error| format!("SVN show task failed: {error}"))?
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

            let open_left = MenuItem::with_id(
                app,
                "open_left",
                "Open Left File...",
                true,
                None::<&str>,
            )?;
            let open_right = MenuItem::with_id(
                app,
                "open_right",
                "Open Right File...",
                true,
                None::<&str>,
            )?;
            let save_focused = MenuItem::with_id(
                app,
                "save_focused",
                "Save Focused File",
                true,
                None::<&str>,
            )?;
            let file_separator = PredefinedMenuItem::separator(app)?;
            let mut file_menu_found = false;
            for item in menu.items()? {
                if let MenuItemKind::Submenu(submenu) = item {
                    if submenu.text().unwrap_or_default() == "File" {
                        submenu.insert(&open_left, 0)?;
                        submenu.insert(&open_right, 1)?;
                        submenu.insert(&save_focused, 2)?;
                        submenu.insert(&file_separator, 3)?;
                        file_menu_found = true;
                        break;
                    }
                }
            }
            if !file_menu_found {
                let file_menu = Submenu::with_id(app, "file", "File", true)?;
                file_menu.append(&open_left)?;
                file_menu.append(&open_right)?;
                file_menu.append(&save_focused)?;
                file_menu.append(&file_separator)?;
                file_menu.append(&PredefinedMenuItem::close_window(app, None)?)?;
                #[cfg(not(target_os = "macos"))]
                file_menu.append(&PredefinedMenuItem::quit(app, None)?)?;
                menu.prepend(&file_menu)?;
            }

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
                "open_left" => {
                    let _ = app.emit("gcompare://open-left", ());
                }
                "open_right" => {
                    let _ = app.emit("gcompare://open-right", ());
                }
                "save_focused" => {
                    let _ = app.emit("gcompare://save-focused", ());
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
            restart_app,
            consume_open_paths,
            git_history,
            git_show_file,
            svn_history,
            vcs_history,
            p4_show_file,
            svn_show_file
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
