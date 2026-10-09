use crate::model::AppResult;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub(crate) const ENTRY_NAME: &str = "NonsPlayer";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutostartStatus {
    enabled: bool,
    blocked_by_system: bool,
}

#[tauri::command]
pub(crate) fn autostart_status(_app: AppHandle) -> AppResult<AutostartStatus> {
    #[cfg(windows)]
    let registered = windows::registered()?;
    #[cfg(not(windows))]
    let registered = _app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let blocked = registered && windows::blocked()?;
    #[cfg(not(windows))]
    let blocked = false;
    Ok(AutostartStatus {
        enabled: registered && !blocked,
        blocked_by_system: blocked,
    })
}

#[tauri::command]
pub(crate) fn set_autostart(enabled: bool, app: AppHandle) -> AppResult<AutostartStatus> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        windows::quote_launch_path()?;
    } else {
        #[cfg(windows)]
        cleanup()?;
        #[cfg(not(windows))]
        manager.disable().map_err(|e| e.to_string())?;
    }
    // Only explicit settings actions clear Windows' approval. Status reads and
    // application startup never override a Task Manager decision.
    #[cfg(windows)]
    windows::clear_approval()?;
    autostart_status(app)
}

#[cfg(windows)]
pub(crate) fn cleanup() -> AppResult<()> {
    windows::remove_value(windows::RUN)?;
    windows::clear_approval()
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::io::ErrorKind;
    use winreg::{enums::*, RegKey};

    const APPROVAL: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    pub(super) const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    pub(super) fn quote_launch_path() -> AppResult<()> {
        // auto-launch 0.5 writes a bare path. Quoting is required for Program Files
        // and any user-selected installation directory containing spaces.
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN, KEY_SET_VALUE)
            .and_then(|key| key.set_value(ENTRY_NAME, &format!("\"{}\"", exe.display())))
            .map_err(|e| e.to_string())
    }

    pub(super) fn registered() -> AppResult<bool> {
        let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN) {
            Ok(key) => key,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e.to_string()),
        };
        match key.get_value::<String, _>(ENTRY_NAME) {
            Ok(command) => {
                let exe = std::env::current_exe().map_err(|e| e.to_string())?;
                Ok(command
                    .trim()
                    .eq_ignore_ascii_case(&format!("\"{}\"", exe.display())))
            }
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    }

    fn approval_blocked(bytes: &[u8]) -> AppResult<bool> {
        // Explorer's format is not a public API; fail visibly for unknown records.
        if bytes.len() != 12 {
            return Err("无法识别 Windows 启动项状态，请在任务管理器中检查".into());
        }
        match u32::from_le_bytes(bytes[..4].try_into().unwrap()) {
            2 | 6 => Ok(false),
            3 | 7 => Ok(true),
            _ => Err("无法识别 Windows 启动项状态，请在任务管理器中检查".into()),
        }
    }

    pub(super) fn blocked() -> AppResult<bool> {
        let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(APPROVAL) {
            Ok(key) => key,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e.to_string()),
        };
        match key.get_raw_value(ENTRY_NAME) {
            Ok(value) if value.vtype == REG_BINARY => approval_blocked(&value.bytes),
            Ok(_) => Err("Windows 启动项状态格式无效".into()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    }

    pub(super) fn clear_approval() -> AppResult<()> {
        remove_value(APPROVAL)
    }

    pub(super) fn remove_value(path: &str) -> AppResult<()> {
        let key =
            match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(path, KEY_SET_VALUE) {
                Ok(key) => key,
                Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
                Err(e) => return Err(e.to_string()),
            };
        match key.delete_value(ENTRY_NAME) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn recognizes_system_veto_and_rejects_unknown_records() {
            for (state, blocked) in [(2u32, false), (3, true), (6, false), (7, true)] {
                let mut record = [0; 12];
                record[..4].copy_from_slice(&state.to_le_bytes());
                assert_eq!(approval_blocked(&record).unwrap(), blocked);
            }
            assert!(approval_blocked(&[0; 12]).is_err());
            assert!(approval_blocked(&[3]).is_err());
        }

        #[test]
        fn cleanup_is_idempotent_and_preserves_other_entries() {
            let path = format!(r"Software\NonsAutostartTest\{}", std::process::id());
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = hkcu.create_subkey(&path).unwrap();
            key.set_value(ENTRY_NAME, &"test").unwrap();
            key.set_value("OtherApp", &"preserved").unwrap();
            remove_value(&path).unwrap();
            remove_value(&path).unwrap();
            assert!(key.get_raw_value(ENTRY_NAME).is_err());
            assert_eq!(key.get_value::<String, _>("OtherApp").unwrap(), "preserved");
            drop(key);
            hkcu.delete_subkey(&path).unwrap();
        }
    }
}
