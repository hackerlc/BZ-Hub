use std::{fs, path::PathBuf};

use windows::{
    core::{s, PCWSTR},
    Win32::{
        Foundation::{FreeLibrary, HMODULE},
        System::LibraryLoader::{GetProcAddress, LoadLibraryW},
    },
};

const BRIDGE_BYTES: &[u8] = include_bytes!(env!("BZ_TASKBAR_XAML_BRIDGE_DLL"));
const BRIDGE_MESSAGE_CAPACITY: usize = 1024;

type SetEnabledFn =
    unsafe extern "system" fn(enabled: i32, message: *mut u16, message_length: u32) -> i32;

pub(crate) enum BridgeResult {
    Applied,
    UseLegacyApi,
}

pub(crate) struct TaskbarXamlBridge {
    module: HMODULE,
    set_enabled: SetEnabledFn,
}

impl TaskbarXamlBridge {
    pub(crate) fn load() -> Result<Self, String> {
        let bridge_path = extract_bridge()?;
        let bridge_path_wide = wide_string(&bridge_path);
        let module = unsafe { LoadLibraryW(PCWSTR(bridge_path_wide.as_ptr())) }
            .map_err(|error| {
                format!(
                    "无法加载内置的 Windows 11 任务栏透明模块：{error}。如果安全软件拦截了临时 DLL，请允许 BZ Hub 后重试"
                )
            })?;
        let procedure = unsafe { GetProcAddress(module, s!("BZHubTaskbarSetEnabled")) };
        let Some(procedure) = procedure else {
            let _ = unsafe { FreeLibrary(module) };
            return Err("内置任务栏透明模块不完整，请重新生成测试版".into());
        };
        let set_enabled = unsafe {
            std::mem::transmute::<unsafe extern "system" fn() -> isize, SetEnabledFn>(procedure)
        };
        Ok(Self {
            module,
            set_enabled,
        })
    }

    pub(crate) fn set_enabled(&self, enabled: bool) -> Result<BridgeResult, String> {
        let mut message = [0_u16; BRIDGE_MESSAGE_CAPACITY];
        let result = unsafe {
            (self.set_enabled)(
                i32::from(enabled),
                message.as_mut_ptr(),
                message.len() as u32,
            )
        };
        match result {
            0 => Ok(BridgeResult::Applied),
            1 => Ok(BridgeResult::UseLegacyApi),
            _ => {
                let length = message
                    .iter()
                    .position(|character| *character == 0)
                    .unwrap_or(message.len());
                let details = String::from_utf16_lossy(&message[..length]);
                if details.trim().is_empty() {
                    Err(format!("Windows 11 任务栏透明模块返回了错误代码 {result}"))
                } else {
                    Err(details)
                }
            }
        }
    }
}

impl Drop for TaskbarXamlBridge {
    fn drop(&mut self) {
        let mut message = [0_u16; BRIDGE_MESSAGE_CAPACITY];
        let _ = unsafe { (self.set_enabled)(0, message.as_mut_ptr(), message.len() as u32) };
        let _ = unsafe { FreeLibrary(self.module) };
    }
}

fn extract_bridge() -> Result<PathBuf, String> {
    let checksum = BRIDGE_BYTES
        .iter()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
        });
    let directory = std::env::temp_dir().join("bz-hub-taskbar");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建任务栏透明模块临时目录：{error}"))?;
    let path = directory.join(format!("bz-hub-taskbar-xaml-{checksum:016x}.dll"));

    let already_current = fs::read(&path)
        .map(|current| current == BRIDGE_BYTES)
        .unwrap_or(false);
    if !already_current {
        fs::write(&path, BRIDGE_BYTES)
            .map_err(|error| format!("无法释放任务栏透明模块：{error}"))?;
    }
    Ok(path)
}

fn wide_string(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{BridgeResult, TaskbarXamlBridge, BRIDGE_BYTES};

    #[test]
    fn embedded_bridge_is_a_windows_dll() {
        assert!(BRIDGE_BYTES.len() > 1024);
        assert_eq!(&BRIDGE_BYTES[..2], b"MZ");
    }

    #[test]
    fn bridge_loads_and_accepts_disabled_state() {
        let bridge = TaskbarXamlBridge::load().expect("bridge DLL should load");
        assert!(matches!(
            bridge.set_enabled(false),
            Ok(BridgeResult::Applied | BridgeResult::UseLegacyApi)
        ));
    }
}
