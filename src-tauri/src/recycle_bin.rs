#[tauri::command]
pub fn open_recycle_bin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg("shell:RecycleBinFolder")
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|error| format!("无法打开回收站：{error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("系统回收站操作仅支持 Windows".into())
}

#[tauri::command]
pub async fn empty_recycle_bin(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::{
            core::PCWSTR,
            Win32::{Foundation::HWND, UI::Shell::SHEmptyRecycleBinW},
        };
        let parent = window
            .hwnd()
            .map_err(|error| format!("无法获取窗口：{error}"))?
            .0 as usize;
        tauri::async_runtime::spawn_blocking(move || {
            // Keep Windows' confirmation and progress UI. Never clear silently.
            // NULL root targets the current user's Recycle Bin across all drives.
            let result =
                unsafe { SHEmptyRecycleBinW(Some(HWND(parent as *mut _)), PCWSTR::null(), 0) };
            match result {
                Ok(()) => Ok(()),
                Err(error)
                    if [0x800704C7_u32, 0x80004004_u32].contains(&(error.code().0 as u32)) =>
                {
                    Ok(())
                }
                Err(error) => Err(format!("无法清空回收站：{error}")),
            }
        })
        .await
        .map_err(|error| format!("回收站操作失败：{error}"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("系统回收站操作仅支持 Windows".into())
    }
}
