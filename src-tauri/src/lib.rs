mod db;
mod parser;

use db::{Db, ImportResult, Shader, ShaderPage, ShaderQuery, ShaderStats};
use parser::Analysis;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{Manager, State};

pub struct AppState {
    db: Arc<Mutex<Db>>,
    db_path: Option<PathBuf>,
    db_warning: Option<String>,
}

fn lock(db: &Arc<Mutex<Db>>) -> MutexGuard<'_, Db> {
    // A panic while holding the lock must never brick the app: recover the guard.
    db.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    db_path: String,
    db_warning: Option<String>,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        db_path: state.db_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "(in-memory)".into()),
        db_warning: state.db_warning.clone(),
    }
}

#[tauri::command]
async fn analyze_log(path: String, slow_threshold_ms: Option<f64>) -> Result<Analysis, String> {
    let thr = slow_threshold_ms.unwrap_or(300.0);
    tauri::async_runtime::spawn_blocking(move || parser::parse_file(std::path::Path::new(&path), thr))
        .await
        .map_err(|e| format!("Internal error while analyzing: {e}"))?
}

#[tauri::command]
fn query_shaders(state: State<'_, AppState>, query: ShaderQuery) -> Result<ShaderPage, String> {
    lock(&state.db).query(&query)
}

#[tauri::command]
fn shader_stats(state: State<'_, AppState>) -> Result<ShaderStats, String> {
    lock(&state.db).stats()
}

#[tauri::command]
fn update_shader(state: State<'_, AppState>, hash: String, status: String, reason: Option<String>) -> Result<Shader, String> {
    lock(&state.db).update(&hash, &status, reason.as_deref())
}

#[tauri::command]
fn delete_shader(state: State<'_, AppState>, hash: String) -> Result<(), String> {
    lock(&state.db).delete(&hash)
}

#[tauri::command]
async fn import_shaders(state: State<'_, AppState>, path: String) -> Result<ImportResult, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("Could not read file: {e}"))?;
        let text = String::from_utf8_lossy(&bytes);
        let items = if path.to_ascii_lowercase().ends_with(".json") { db::parse_json(&text)? } else { db::parse_csv(&text) };
        if items.is_empty() {
            return Err("No shaders found in the file.".into());
        }
        lock(&db).upsert_many(&items, true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn track_shaders(state: State<'_, AppState>, items: Vec<Shader>) -> Result<ImportResult, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || lock(&db).upsert_many(&items, false))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn export_shaders_csv(state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let rows = lock(&state.db).all()?;
    std::fs::write(&path, db::to_csv(&rows)).map_err(|e| format!("Could not save file: {e}"))?;
    Ok(rows.len())
}

#[tauri::command]
fn reset_shader_demo(state: State<'_, AppState>) -> Result<(), String> {
    lock(&state.db).reset_demo()
}

#[tauri::command]
fn clear_shaders(state: State<'_, AppState>) -> Result<(), String> {
    lock(&state.db).clear_all()
}

#[tauri::command]
fn set_expected_total(state: State<'_, AppState>, total: i64) -> Result<(), String> {
    if !(1..=10_000_000).contains(&total) {
        return Err("Invalid value".into());
    }
    lock(&state.db).set_meta("expected_total", &total.to_string())
}

#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not save file: {e}"))
}

#[tauri::command]
fn save_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not save file: {e}"))
}

fn open_database(app: &tauri::App) -> (Db, Option<PathBuf>, Option<String>) {
    let attempt = (|| -> Result<(Db, PathBuf), String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("aurorabr.db");
        Ok((Db::open(&path)?, path))
    })();
    match attempt {
        Ok((db, path)) => (db, Some(path), None),
        Err(e) => {
            let db = Db::open_in_memory().expect("in-memory SQLite must always open");
            (db, None, Some(format!("Local database unavailable ({e}). Using temporary in-memory storage — data will not be saved.")))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let (db, db_path, db_warning) = open_database(app);
            app.manage(AppState { db: Arc::new(Mutex::new(db)), db_path, db_warning });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            analyze_log,
            query_shaders,
            shader_stats,
            update_shader,
            delete_shader,
            import_shaders,
            track_shaders,
            export_shaders_csv,
            reset_shader_demo,
            clear_shaders,
            set_expected_total,
            save_text_file,
            save_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuroraBR");
}
