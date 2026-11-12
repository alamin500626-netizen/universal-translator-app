mod history;
mod providers;
mod secrets;

use std::{collections::HashMap, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

pub struct AppState {
    db: Mutex<rusqlite::Connection>,
    cache: Mutex<HashMap<String, providers::TranslateResult>>,
    http: reqwest::Client,
}

#[tauri::command]
async fn translate(state: State<'_, AppState>, req: providers::TranslateRequest)
    -> Result<providers::TranslateResult, String> {
    let key = format!("{}|{}|{}|{}|{}", req.provider, req.source, req.target, req.style, req.text);
    if let Some(hit) = state.cache.lock().unwrap().get(&key) { return Ok(hit.clone()); }
    let client = state.http.clone();
    let res = providers::translate(&client, &req).await?;
    {
        let mut cache = state.cache.lock().unwrap();
        if cache.len() > 500 { cache.clear(); }
        cache.insert(key, res.clone());
    }
    Ok(res)
}

#[tauri::command]
async fn languages(state: State<'_, AppState>, provider: String, base_url: Option<String>)
    -> Result<Vec<providers::Lang>, String> {
    let client = state.http.clone();
    providers::languages(&client, &provider, base_url.as_deref()).await
}

#[tauri::command]
fn set_api_key(provider: String, key: String) -> Result<(), String> { secrets::set(&provider, &key) }
#[tauri::command]
fn clear_api_key(provider: String) -> Result<(), String> { secrets::clear(&provider) }
#[tauri::command]
fn has_api_key(provider: String) -> bool { secrets::get(&provider).is_some() }

#[tauri::command]
fn history_add(state: State<'_, AppState>, entry: history::NewEntry) -> Result<(), String> {
    history::add(&state.db.lock().unwrap(), &entry).map_err(|e| e.to_string())
}
#[tauri::command]
fn history_list(state: State<'_, AppState>, query: String, favorites_only: bool)
    -> Result<Vec<history::Entry>, String> {
    history::list(&state.db.lock().unwrap(), &query, favorites_only).map_err(|e| e.to_string())
}
#[tauri::command]
fn history_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> Result<(), String> {
    history::favorite(&state.db.lock().unwrap(), id, favorite).map_err(|e| e.to_string())
}
#[tauri::command]
fn history_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    history::delete(&state.db.lock().unwrap(), id).map_err(|e| e.to_string())
}
#[tauri::command]
fn history_clear(state: State<'_, AppState>) -> Result<(), String> {
    history::clear(&state.db.lock().unwrap()).map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = history::open(&dir.join("history.db"))?;
            let http = reqwest::Client::builder().user_agent("UniversalTranslator/1.0").build()?;
            app.manage(AppState { db: Mutex::new(db), cache: Mutex::new(HashMap::new()), http });

            let show = MenuItem::with_id(app, "show", "Show Translator", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Universal Translator")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // Closing hides to the tray; use the tray menu to quit.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            translate, languages, set_api_key, clear_api_key, has_api_key,
            history_add, history_list, history_favorite, history_delete, history_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running Universal Translator");
}
