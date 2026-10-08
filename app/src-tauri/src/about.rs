use crate::model::AppResult;
use tauri::Manager;

#[tauri::command]
pub fn open_devtools(app: tauri::AppHandle) -> AppResult<()> {
    app.get_webview_window("main")
        .ok_or("主窗口不可用")?
        .open_devtools();
    Ok(())
}
