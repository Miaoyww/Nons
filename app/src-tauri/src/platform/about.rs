use crate::model::AppResult;
#[cfg(debug_assertions)]
use tauri::Manager;

#[tauri::command]
pub fn open_devtools(app: tauri::AppHandle) -> AppResult<()> {
    #[cfg(debug_assertions)]
    {
        app.get_webview("main")
            .ok_or("主窗口不可用")?
            .open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Err("发布版不提供开发者工具".into())
    }
}
