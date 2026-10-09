use crate::{application::Backend, model::AppResult};
use serde::{Deserialize, Serialize};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, Window,
    WindowEvent,
};

const TRAY_WINDOW: &str = "tray-menu";
const WIDTH: f64 = 320.0;
const HEIGHT: f64 = 328.0;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloseBehavior {
    #[default]
    Close,
    Minimize,
}

fn read_close_behavior(store: &crate::storage::Store) -> AppResult<CloseBehavior> {
    Ok(
        if store.setting("closeBehavior")?.as_deref() == Some("minimize") {
            CloseBehavior::Minimize
        } else {
            CloseBehavior::Close
        },
    )
}

#[tauri::command]
pub(crate) fn close_behavior(backend: tauri::State<'_, Backend>) -> AppResult<CloseBehavior> {
    read_close_behavior(&backend.store)
}

#[tauri::command]
pub(crate) fn set_close_behavior(
    behavior: CloseBehavior,
    backend: tauri::State<'_, Backend>,
) -> AppResult<()> {
    backend.store.set_setting(
        "closeBehavior",
        match behavior {
            CloseBehavior::Close => "close",
            CloseBehavior::Minimize => "minimize",
        },
    )
}

fn open_main(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn tray_action(action: String, app: AppHandle) -> AppResult<()> {
    if !matches!(action.as_str(), "open" | "settings" | "exit" | "dismiss") {
        return Err("托盘操作无效".into());
    }
    if let Some(window) = app.get_webview_window(TRAY_WINDOW) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    match action.as_str() {
        "open" => open_main(&app).map_err(|e| e.to_string())?,
        "settings" => {
            open_main(&app).map_err(|e| e.to_string())?;
            app.emit_to("main", "open-settings", ())
                .map_err(|e| e.to_string())?;
        }
        "exit" => app.exit(0),
        "dismiss" => {}
        _ => return Err("托盘操作无效".into()),
    }
    Ok(())
}

fn popup_position(
    point: PhysicalPosition<f64>,
    origin: PhysicalPosition<i32>,
    width: f64,
    height: f64,
    scale: f64,
) -> PhysicalPosition<i32> {
    let x = (point.x - WIDTH * scale).clamp(
        origin.x as f64,
        (origin.x as f64 + width - WIDTH * scale).max(origin.x as f64),
    );
    let y = (point.y - HEIGHT * scale).clamp(
        origin.y as f64,
        (origin.y as f64 + height - HEIGHT * scale).max(origin.y as f64),
    );
    PhysicalPosition::new(x.round() as i32, y.round() as i32)
}

fn show_menu(app: &AppHandle, point: PhysicalPosition<f64>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(TRAY_WINDOW) {
        window.set_focus()?;
        return Ok(());
    }
    let monitor = app
        .monitor_from_point(point.x, point.y)?
        .or(app.primary_monitor()?);
    let scale = monitor.as_ref().map_or(1.0, |m| m.scale_factor());
    let position = monitor.as_ref().map_or(
        PhysicalPosition::new(point.x as i32, point.y as i32),
        |monitor| {
            let area = monitor.work_area();
            popup_position(
                point,
                area.position,
                area.size.width as f64,
                area.size.height as f64,
                scale,
            )
        },
    );
    let window =
        WebviewWindowBuilder::new(app, TRAY_WINDOW, WebviewUrl::App("index.html?tray".into()))
            .title("Nons 托盘菜单")
            .inner_size(WIDTH, HEIGHT)
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .build()?;
    // Ignore initial unfocused notifications while the hidden WebView is created.
    let popup = window.clone();
    let focused_once = std::sync::atomic::AtomicBool::new(false);
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            focused_once.store(true, std::sync::atomic::Ordering::Relaxed)
        }
        WindowEvent::Focused(false) if focused_once.load(std::sync::atomic::Ordering::Relaxed) => {
            let _ = popup.destroy();
        }
        _ => {}
    });
    window.set_position(position)?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub(crate) fn setup(app: &tauri::App) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id("nons-tray")
        .tooltip("NonsPlayer")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let result = match event {
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => show_menu(tray.app_handle(), position),
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => open_main(tray.app_handle()),
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("托盘操作失败：{error}");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    // Linux tray implementations do not emit pointer events. Keep a native menu
    // available so a hidden main window can always be restored or exited.
    #[cfg(target_os = "linux")]
    {
        use tauri::menu::{Menu, MenuItem};
        let open = MenuItem::with_id(app, "open", "打开", true, None::<&str>)?;
        let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
        let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &settings, &exit])?;
        tray = tray.menu(&menu).on_menu_event(|app, event| {
            let app = app.clone();
            let action = event.id().as_ref().to_string();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = tray_action(action, app).await {
                    eprintln!("托盘操作失败：{error}");
                }
            });
        });
    }
    tray.build(app)?;
    Ok(())
}

pub(crate) fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let backend = window.state::<Backend>();
        match read_close_behavior(&backend.store).unwrap_or_default() {
            CloseBehavior::Minimize => {
                let _ = window.hide();
            }
            CloseBehavior::Close => window.app_handle().exit(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popup_stays_in_work_area_with_scale_and_negative_monitor_coordinates() {
        let position = popup_position(
            PhysicalPosition::new(-5.0, 1400.0),
            PhysicalPosition::new(-1920, 0),
            1920.0,
            1400.0,
            1.5,
        );
        assert_eq!(position, PhysicalPosition::new(-485, 908));
        let position = popup_position(
            PhysicalPosition::new(-1900.0, 12.0),
            PhysicalPosition::new(-1920, 40),
            1920.0,
            1360.0,
            1.5,
        );
        assert_eq!(position, PhysicalPosition::new(-1920, 40));
    }

    #[test]
    fn close_behavior_persists_and_defaults_to_close() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.sqlite3");
        let store = crate::storage::Store::open(&path).unwrap();
        assert_eq!(read_close_behavior(&store).unwrap(), CloseBehavior::Close);
        store.set_setting("closeBehavior", "minimize").unwrap();
        drop(store);
        let store = crate::storage::Store::open(&path).unwrap();
        assert_eq!(
            read_close_behavior(&store).unwrap(),
            CloseBehavior::Minimize
        );
        store.set_setting("closeBehavior", "invalid").unwrap();
        assert_eq!(read_close_behavior(&store).unwrap(), CloseBehavior::Close);
        assert_eq!(
            serde_json::from_str::<CloseBehavior>("\"minimize\"").unwrap(),
            CloseBehavior::Minimize
        );
        assert!(serde_json::from_str::<CloseBehavior>("\"invalid\"").is_err());
    }
}
