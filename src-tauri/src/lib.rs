use serde::{Deserialize, Serialize};
mod recycle_bin;
#[cfg(target_os = "windows")]
mod taskbar_xaml;
use std::process::Command;
use std::{
    collections::VecDeque,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg(target_os = "windows")]
use taskbar_xaml::{BridgeResult, TaskbarXamlBridge};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
use windows::{
    core::{s, w, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE},
        System::{
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
            Power::{
                SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
                EXECUTION_STATE,
            },
        },
        UI::{
            Shell::ShellExecuteW,
            WindowsAndMessaging::{
                FindWindowExW, FindWindowW, PostMessageW, SW_SHOWNORMAL, WM_DWMCOMPOSITIONCHANGED,
            },
        },
    },
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
type KeepAwakeRequest = (bool, std::sync::mpsc::Sender<Result<(), String>>);

#[cfg(target_os = "windows")]
struct KeepAwakeController {
    sender: std::sync::mpsc::Sender<KeepAwakeRequest>,
}

#[cfg(target_os = "windows")]
impl KeepAwakeController {
    fn new() -> Self {
        let (sender, receiver) = std::sync::mpsc::channel::<KeepAwakeRequest>();
        std::thread::spawn(move || {
            let mut enabled = false;
            while let Ok((next_enabled, reply)) = receiver.recv() {
                let flags = if next_enabled {
                    ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                } else {
                    ES_CONTINUOUS
                };
                let previous = unsafe { SetThreadExecutionState(flags) };
                let result = if previous == EXECUTION_STATE(0) {
                    Err(format!(
                        "Windows 无法修改电源执行状态：{}",
                        std::io::Error::last_os_error()
                    ))
                } else {
                    enabled = next_enabled;
                    Ok(())
                };
                let _ = reply.send(result);
            }

            if enabled {
                let _ = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            }
        });
        Self { sender }
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let (reply_sender, reply_receiver) = std::sync::mpsc::channel();
        self.sender
            .send((enabled, reply_sender))
            .map_err(|_| "保持唤醒服务已经停止".to_string())?;
        reply_receiver
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "保持唤醒服务响应超时".to_string())?
    }
}

#[cfg(target_os = "macos")]
struct KeepAwakeController {
    process: std::sync::Mutex<Option<std::process::Child>>,
}

#[cfg(target_os = "macos")]
impl KeepAwakeController {
    fn new() -> Self {
        Self {
            process: std::sync::Mutex::new(None),
        }
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| "无法访问 macOS 保持唤醒状态".to_string())?;

        if enabled {
            if let Some(child) = process.as_mut() {
                if child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_none()
                {
                    return Ok(());
                }
            }

            let app_pid = std::process::id().to_string();
            let child = Command::new("/usr/bin/caffeinate")
                .args(["-d", "-i", "-w", &app_pid])
                .spawn()
                .map_err(|error| format!("macOS 无法启用保持唤醒：{error}"))?;
            *process = Some(child);
        } else if let Some(mut child) = process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(())
    }
}

#[cfg(target_os = "macos")]
impl Drop for KeepAwakeController {
    fn drop(&mut self) {
        if let Ok(process) = self.process.get_mut() {
            if let Some(child) = process.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
struct KeepAwakeController;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl KeepAwakeController {
    fn new() -> Self {
        Self
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if enabled {
            Err("当前平台暂不支持保持唤醒".into())
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
fn set_keep_awake(
    enabled: bool,
    controller: tauri::State<'_, KeepAwakeController>,
) -> Result<(), String> {
    controller.set_enabled(enabled)
}

#[cfg(target_os = "windows")]
const TASKBAR_TRANSPARENCY_REFRESH_INTERVAL: Duration = Duration::from_secs(2);

#[cfg(target_os = "windows")]
const TASKBAR_TRANSPARENCY_RESPONSE_TIMEOUT: Duration = Duration::from_secs(45);

#[cfg(target_os = "windows")]
const ACCENT_DISABLED: i32 = 0;

#[cfg(target_os = "windows")]
const ACCENT_ENABLE_TRANSPARENT_GRADIENT: i32 = 2;

#[cfg(target_os = "windows")]
const WCA_ACCENT_POLICY: i32 = 19;

#[cfg(target_os = "windows")]
const DWMSBT_AUTO: i32 = 0;

#[cfg(target_os = "windows")]
const DWMSBT_NONE: i32 = 1;

#[cfg(target_os = "windows")]
const FULLY_TRANSPARENT_WHITE_ABGR: u32 = 0x00FF_FFFF;

#[cfg(target_os = "windows")]
#[repr(C)]
struct AccentPolicy {
    accent_state: i32,
    accent_flags: u32,
    gradient_color: u32,
    animation_id: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct WindowCompositionAttributeData {
    attribute: i32,
    data: *mut std::ffi::c_void,
    size: usize,
}

#[cfg(target_os = "windows")]
type SetWindowCompositionAttributeFn =
    unsafe extern "system" fn(HWND, *mut WindowCompositionAttributeData) -> i32;

#[cfg(target_os = "windows")]
fn taskbar_accent_policy(enabled: bool) -> AccentPolicy {
    AccentPolicy {
        accent_state: if enabled {
            ACCENT_ENABLE_TRANSPARENT_GRADIENT
        } else {
            ACCENT_DISABLED
        },
        accent_flags: if enabled { 2 } else { 0 },
        // Some Windows 11 builds interpret an all-zero color as unspecified.
        // Alpha remains zero, while non-zero RGB keeps the value explicit.
        gradient_color: if enabled {
            FULLY_TRANSPARENT_WHITE_ABGR
        } else {
            0
        },
        animation_id: 0,
    }
}

#[cfg(target_os = "windows")]
fn set_taskbar_system_backdrop(taskbar: HWND, enabled: bool) {
    let backdrop = if enabled { DWMSBT_NONE } else { DWMSBT_AUTO };
    // Windows 11 can paint a system backdrop above the legacy accent policy.
    // Older Windows versions reject this attribute, where the accent policy
    // remains sufficient, so the call is intentionally best-effort.
    let _ = unsafe {
        DwmSetWindowAttribute(
            taskbar,
            DWMWA_SYSTEMBACKDROP_TYPE,
            (&backdrop as *const i32).cast(),
            std::mem::size_of::<i32>() as u32,
        )
    };
}

#[cfg(target_os = "windows")]
fn taskbar_windows() -> Vec<HWND> {
    let mut taskbars = Vec::new();
    if let Ok(primary) = unsafe { FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) } {
        taskbars.push(primary);
    }

    let mut previous = None;
    while let Ok(secondary) =
        unsafe { FindWindowExW(None, previous, w!("Shell_SecondaryTrayWnd"), PCWSTR::null()) }
    {
        taskbars.push(secondary);
        previous = Some(secondary);
    }
    taskbars
}

#[cfg(target_os = "windows")]
fn taskbar_composition_function() -> Result<SetWindowCompositionAttributeFn, String> {
    let user32 = unsafe { GetModuleHandleW(w!("user32.dll")) }
        .map_err(|error| format!("无法访问 Windows 窗口服务：{error}"))?;
    let procedure = unsafe { GetProcAddress(user32, s!("SetWindowCompositionAttribute")) }
        .ok_or_else(|| "当前 Windows 版本不支持任务栏透明接口".to_string())?;
    Ok(unsafe {
        std::mem::transmute::<unsafe extern "system" fn() -> isize, SetWindowCompositionAttributeFn>(
            procedure,
        )
    })
}

#[cfg(target_os = "windows")]
fn apply_taskbar_transparency(
    enabled: bool,
    xaml_bridge: &mut Option<TaskbarXamlBridge>,
) -> Result<(), String> {
    if xaml_bridge.is_none() {
        *xaml_bridge = Some(TaskbarXamlBridge::load()?);
    }
    match xaml_bridge
        .as_ref()
        .expect("taskbar XAML bridge was just initialized")
        .set_enabled(enabled)?
    {
        BridgeResult::Applied => return Ok(()),
        BridgeResult::UseLegacyApi => {}
    }

    let taskbars = taskbar_windows();
    if taskbars.is_empty() {
        return if enabled {
            Err("没有找到 Windows 任务栏，Explorer 可能正在重启".into())
        } else {
            Ok(())
        };
    }

    let set_window_composition_attribute = taskbar_composition_function()?;
    let mut failures = Vec::new();
    for &taskbar in &taskbars {
        set_taskbar_system_backdrop(taskbar, enabled);
        let mut policy = taskbar_accent_policy(enabled);
        let mut data = WindowCompositionAttributeData {
            attribute: WCA_ACCENT_POLICY,
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };
        let result = unsafe { set_window_composition_attribute(taskbar, &mut data) };
        if result == 0 {
            failures.push(std::io::Error::last_os_error().to_string());
        }
        if !enabled {
            let _ = unsafe {
                PostMessageW(
                    Some(taskbar),
                    WM_DWMCOMPOSITIONCHANGED,
                    WPARAM(1),
                    LPARAM(0),
                )
            };
        }
    }

    if failures.is_empty() {
        return Ok(());
    }

    if enabled {
        for taskbar in taskbars {
            set_taskbar_system_backdrop(taskbar, false);
            let mut policy = taskbar_accent_policy(false);
            let mut data = WindowCompositionAttributeData {
                attribute: WCA_ACCENT_POLICY,
                data: (&mut policy as *mut AccentPolicy).cast(),
                size: std::mem::size_of::<AccentPolicy>(),
            };
            let _ = unsafe { set_window_composition_attribute(taskbar, &mut data) };
            let _ = unsafe {
                PostMessageW(
                    Some(taskbar),
                    WM_DWMCOMPOSITIONCHANGED,
                    WPARAM(1),
                    LPARAM(0),
                )
            };
        }
    }
    Err(format!(
        "Windows 无法修改 {} 个任务栏的外观：{}",
        failures.len(),
        failures.join("；")
    ))
}

#[cfg(target_os = "windows")]
enum TaskbarTransparencyRequest {
    Set {
        enabled: bool,
        reply: std::sync::mpsc::Sender<Result<(), String>>,
    },
    Stop,
}

#[cfg(target_os = "windows")]
struct TaskbarTransparencyController {
    sender: std::sync::mpsc::Sender<TaskbarTransparencyRequest>,
    enabled: Arc<std::sync::atomic::AtomicBool>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

#[cfg(target_os = "windows")]
impl TaskbarTransparencyController {
    fn new() -> Self {
        let (sender, receiver) = std::sync::mpsc::channel::<TaskbarTransparencyRequest>();
        let enabled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let worker_enabled = Arc::clone(&enabled);
        let worker = std::thread::Builder::new()
            .name("bz-hub-taskbar-transparency".into())
            .spawn(move || {
                let mut active = false;
                let mut xaml_bridge = None;
                loop {
                    let wait = if active {
                        TASKBAR_TRANSPARENCY_REFRESH_INTERVAL
                    } else {
                        Duration::from_secs(86_400)
                    };
                    match receiver.recv_timeout(wait) {
                        Ok(TaskbarTransparencyRequest::Set {
                            enabled: next,
                            reply,
                        }) => {
                            let result = apply_taskbar_transparency(next, &mut xaml_bridge);
                            if result.is_ok() {
                                active = next;
                                worker_enabled.store(next, std::sync::atomic::Ordering::Release);
                            }
                            let _ = reply.send(result);
                        }
                        Ok(TaskbarTransparencyRequest::Stop) => {
                            if active {
                                let _ = apply_taskbar_transparency(false, &mut xaml_bridge);
                            }
                            worker_enabled.store(false, std::sync::atomic::Ordering::Release);
                            break;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            if active {
                                let _ = apply_taskbar_transparency(true, &mut xaml_bridge);
                            }
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            if active {
                                let _ = apply_taskbar_transparency(false, &mut xaml_bridge);
                            }
                            break;
                        }
                    }
                }
            })
            .expect("failed to start taskbar transparency worker");
        Self {
            sender,
            enabled,
            worker: Mutex::new(Some(worker)),
        }
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if !enabled && !self.enabled.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(());
        }
        let (reply_sender, reply_receiver) = std::sync::mpsc::channel();
        self.sender
            .send(TaskbarTransparencyRequest::Set {
                enabled,
                reply: reply_sender,
            })
            .map_err(|_| "任务栏透明服务已经停止".to_string())?;
        reply_receiver
            // Explorer can require several VisualDiagConnection attempts before
            // accepting a XAML diagnostics session. Keep this outer wait longer
            // than the native bridge's complete retry window.
            .recv_timeout(TASKBAR_TRANSPARENCY_RESPONSE_TIMEOUT)
            .map_err(|_| "任务栏透明服务在 45 秒内没有响应，请完全退出 BZ Hub 后重试".to_string())?
    }

    fn restore_if_enabled(&self) {
        if self.enabled.load(std::sync::atomic::Ordering::Acquire) {
            let _ = self.set_enabled(false);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for TaskbarTransparencyController {
    fn drop(&mut self) {
        let _ = self.sender.send(TaskbarTransparencyRequest::Stop);
        if let Ok(worker) = self.worker.get_mut() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
struct TaskbarTransparencyController;

#[cfg(not(target_os = "windows"))]
impl TaskbarTransparencyController {
    fn new() -> Self {
        Self
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if enabled {
            Err("任务栏透明仅支持 Windows".into())
        } else {
            Ok(())
        }
    }

    fn restore_if_enabled(&self) {}
}

#[tauri::command]
fn set_taskbar_transparent(
    enabled: bool,
    controller: State<'_, TaskbarTransparencyController>,
) -> Result<(), String> {
    controller.set_enabled(enabled)
}

const WALLPAPER_BRIDGE_FIRST_PORT: u16 = 43_821;
const WALLPAPER_BRIDGE_PORT_COUNT: u16 = 12;
const WALLPAPER_BRIDGE_MAX_PAYLOAD_BYTES: usize = 512 * 1024;

#[derive(Clone)]
struct WallpaperBridge {
    snapshot: Arc<Mutex<String>>,
    port: Arc<Mutex<Option<u16>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WallpaperBridgeInfo {
    available: bool,
    url: Option<String>,
    port: Option<u16>,
}

impl WallpaperBridge {
    fn new() -> Self {
        let initial = serde_json::json!({
            "version": 1,
            "available": false,
            "weather": null,
            "updatedAt": null,
        })
        .to_string();
        Self {
            snapshot: Arc::new(Mutex::new(initial)),
            port: Arc::new(Mutex::new(None)),
        }
    }

    fn start(&self) {
        let listener = (0..WALLPAPER_BRIDGE_PORT_COUNT)
            .find_map(|offset| {
                TcpListener::bind((
                    "127.0.0.1",
                    WALLPAPER_BRIDGE_FIRST_PORT.saturating_add(offset),
                ))
                .ok()
            })
            .or_else(|| TcpListener::bind(("127.0.0.1", 0)).ok());
        let Some(listener) = listener else {
            return;
        };
        let Ok(port) = listener.local_addr().map(|address| address.port()) else {
            return;
        };

        let Ok(mut configured_port) = self.port.lock() else {
            return;
        };
        if configured_port.is_some() {
            return;
        }
        *configured_port = Some(port);
        drop(configured_port);

        let snapshot = Arc::clone(&self.snapshot);
        let _ = std::thread::Builder::new()
            .name("bz-hub-wallpaper-bridge".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let snapshot = Arc::clone(&snapshot);
                    let _ = std::thread::Builder::new()
                        .name("bz-hub-wallpaper-request".into())
                        .spawn(move || serve_wallpaper_connection(stream, snapshot));
                }
            });
    }

    fn info(&self) -> WallpaperBridgeInfo {
        let port = self.port.lock().ok().and_then(|value| *value);
        WallpaperBridgeInfo {
            available: port.is_some(),
            url: port.map(|value| format!("http://127.0.0.1:{value}/v1/weather")),
            port,
        }
    }
}

fn serve_wallpaper_connection(mut stream: TcpStream, snapshot: Arc<Mutex<String>>) {
    let mut request_buffer = [0_u8; 8 * 1024];
    let Ok(bytes_read) = stream.read(&mut request_buffer) else {
        return;
    };
    if bytes_read == 0 {
        return;
    }

    let request = String::from_utf8_lossy(&request_buffer[..bytes_read]);
    let mut request_line = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = request_line.next().unwrap_or_default();
    let path = request_line.next().unwrap_or_default();
    let route = path.split('?').next().unwrap_or(path);

    let (status, content_type, body) = match (method, route) {
        ("OPTIONS", _) => ("204 No Content", "text/plain; charset=utf-8", String::new()),
        ("GET", "/v1/weather") => {
            let body = snapshot
                .lock()
                .map(|value| value.clone())
                .unwrap_or_else(|_| {
                    serde_json::json!({
                        "version": 1,
                        "available": false,
                        "weather": null,
                        "error": "BZ Hub 天气桥接暂时不可用"
                    })
                    .to_string()
                });
            ("200 OK", "application/json; charset=utf-8", body)
        }
        _ => (
            "404 Not Found",
            "application/json; charset=utf-8",
            serde_json::json!({ "error": "Not Found" }).to_string(),
        ),
    };

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

#[tauri::command]
fn wallpaper_bridge_info(bridge: State<'_, WallpaperBridge>) -> WallpaperBridgeInfo {
    bridge.start();
    bridge.info()
}

#[tauri::command]
fn set_wallpaper_weather(
    snapshot: Option<String>,
    bridge: State<'_, WallpaperBridge>,
) -> Result<(), String> {
    let payload = snapshot.unwrap_or_else(|| {
        serde_json::json!({
            "version": 1,
            "available": false,
            "weather": null,
            "updatedAt": null,
        })
        .to_string()
    });
    if payload.len() > WALLPAPER_BRIDGE_MAX_PAYLOAD_BYTES {
        return Err("动态桌面天气数据过大，无法更新".into());
    }
    let value: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|error| format!("动态桌面天气数据不是有效 JSON：{error}"))?;
    if !value.is_object() {
        return Err("动态桌面天气数据必须是 JSON 对象".into());
    }
    bridge
        .snapshot
        .lock()
        .map_err(|_| "无法更新动态桌面天气数据".to_string())?
        .clone_from(&payload);
    Ok(())
}

#[tauri::command]
fn configure_wallpaper_project(
    project_path: String,
    bridge: State<'_, WallpaperBridge>,
) -> Result<String, String> {
    bridge.start();
    let raw_path = project_path.trim();
    if raw_path.is_empty() {
        return Err("请先选择 Wallpaper Engine 项目文件夹或 index.html".into());
    }
    let selected = Path::new(raw_path);
    let directory = if selected.is_dir() {
        selected.to_path_buf()
    } else {
        selected
            .parent()
            .ok_or_else(|| "动态桌面项目路径无效".to_string())?
            .to_path_buf()
    };
    if !directory.is_dir() {
        return Err("动态桌面项目文件夹不存在".into());
    }
    if !directory.join("index.html").is_file() {
        return Err("所选文件夹中没有 index.html，无法作为 Web Wallpaper 项目".into());
    }
    let info = bridge.info();
    let Some(endpoint) = info.url else {
        return Err("动态桌面天气桥接启动失败，请重启 BZ Hub 后重试".into());
    };
    let config_path = directory.join("bridge.json");
    let contents = serde_json::json!({
        "version": 1,
        "endpoint": endpoint,
        "updatedAt": chrono_like_now(),
        "source": "BZ Hub",
    })
    .to_string();
    fs::write(&config_path, contents)
        .map_err(|error| format!("无法写入动态桌面桥接配置：{error}"))?;
    let script_path = directory.join("bridge.js");
    let endpoint_literal = serde_json::to_string(&endpoint)
        .map_err(|error| format!("无法生成动态桌面桥接脚本：{error}"))?;
    let script = format!(
        "// Generated by BZ Hub. Do not put API keys in this file.\nwindow.BZ_HUB_WEATHER_ENDPOINT = {endpoint_literal};\n"
    );
    fs::write(&script_path, script)
        .map_err(|error| format!("无法写入动态桌面桥接脚本：{error}"))?;
    Ok(config_path.to_string_lossy().into_owned())
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{seconds}")
}

const AI_CONTROL_ARGUMENT: &str = "--bz-hub-control";
const AI_CONTROL_CONFIG_FILE: &str = "bz-hub-ai-control.json";
const AI_CONTROL_MAX_PAYLOAD_BYTES: u64 = 128 * 1024;

#[derive(Default)]
struct AiControlQueue(Mutex<VecDeque<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueuedAiControlRequest {
    request_path: String,
    contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiControlConfig {
    version: u8,
    enabled: bool,
    token: String,
    executable: String,
}

fn ai_control_paths_from_args(args: &[String]) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if args[index] == AI_CONTROL_ARGUMENT {
            if let Some(value) = args.get(index + 1) {
                paths.push(PathBuf::from(value));
                index += 2;
                continue;
            }
        } else if let Some(value) = args[index].strip_prefix(&format!("{AI_CONTROL_ARGUMENT}=")) {
            if !value.is_empty() {
                paths.push(PathBuf::from(value));
            }
        }
        index += 1;
    }
    paths
}

fn validate_ai_control_filename(path: &Path) -> Result<String, String> {
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "AI 控制请求文件名无效".to_string())?;
    let identifier = filename
        .strip_prefix("bz-hub-ai-")
        .and_then(|value| value.strip_suffix(".request.json"))
        .ok_or_else(|| "AI 控制请求文件名不受信任".to_string())?;
    if !(8..=96).contains(&identifier.len())
        || !identifier
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("AI 控制请求标识无效".into());
    }
    Ok(identifier.to_string())
}

fn validate_ai_control_request_path(path: &Path, require_file: bool) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("AI 控制请求必须使用绝对路径".into());
    }
    validate_ai_control_filename(path)?;

    let parent = path
        .parent()
        .ok_or_else(|| "AI 控制请求路径缺少父目录".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法验证 AI 控制请求目录：{error}"))?;
    let temporary_directory = std::env::temp_dir()
        .canonicalize()
        .map_err(|error| format!("无法读取系统临时目录：{error}"))?;
    if parent != temporary_directory {
        return Err("AI 控制请求只能来自系统临时目录".into());
    }

    if require_file {
        let metadata =
            fs::symlink_metadata(path).map_err(|error| format!("无法读取 AI 控制请求：{error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("AI 控制请求必须是普通文件".into());
        }
        if metadata.len() > AI_CONTROL_MAX_PAYLOAD_BYTES {
            return Err("AI 控制请求过大".into());
        }
    }

    Ok(path.to_path_buf())
}

fn ai_control_response_path(request_path: &Path) -> Result<PathBuf, String> {
    let identifier = validate_ai_control_filename(request_path)?;
    let parent = request_path
        .parent()
        .ok_or_else(|| "AI 控制请求路径缺少父目录".to_string())?;
    Ok(parent.join(format!("bz-hub-ai-{identifier}.response.json")))
}

fn queue_ai_control_args<R: Runtime>(app: &AppHandle<R>, args: &[String]) -> bool {
    let paths = ai_control_paths_from_args(args);
    if paths.is_empty() {
        return false;
    }

    let queue = app.state::<AiControlQueue>();
    let mut queued_any = false;
    if let Ok(mut pending) = queue.0.lock() {
        for path in paths {
            let Ok(path) = validate_ai_control_request_path(&path, true) else {
                continue;
            };
            if !pending.contains(&path) {
                pending.push_back(path);
                queued_any = true;
            }
        }
    }

    if queued_any {
        let _ = app.emit("ai-control-request-ready", ());
    }
    queued_any
}

#[tauri::command]
fn take_ai_control_requests(
    queue: tauri::State<'_, AiControlQueue>,
) -> Result<Vec<QueuedAiControlRequest>, String> {
    let paths: Vec<PathBuf> = queue
        .0
        .lock()
        .map_err(|_| "无法访问 AI 控制请求队列".to_string())?
        .drain(..)
        .collect();

    let mut requests = Vec::with_capacity(paths.len());
    for path in paths {
        let path = validate_ai_control_request_path(&path, true)?;
        let contents =
            fs::read_to_string(&path).map_err(|error| format!("无法读取 AI 控制请求：{error}"))?;
        requests.push(QueuedAiControlRequest {
            request_path: path.to_string_lossy().into_owned(),
            contents,
        });
    }
    Ok(requests)
}

#[tauri::command]
fn complete_ai_control_request(request_path: String, contents: String) -> Result<(), String> {
    if contents.len() as u64 > AI_CONTROL_MAX_PAYLOAD_BYTES {
        return Err("AI 控制响应过大".into());
    }
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("AI 控制响应不是有效的 JSON：{error}"))?;

    let request_path = validate_ai_control_request_path(Path::new(&request_path), true)?;
    let response_path = ai_control_response_path(&request_path)?;
    let temporary_path = response_path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("无法写入 AI 控制响应：{error}"))?;
    fs::rename(&temporary_path, &response_path)
        .map_err(|error| format!("无法提交 AI 控制响应：{error}"))?;
    fs::remove_file(&request_path).map_err(|error| format!("无法清理 AI 控制请求：{error}"))?;
    Ok(())
}

#[tauri::command]
fn configure_ai_control(app: AppHandle, enabled: bool, token: String) -> Result<String, String> {
    if !(32..=128).contains(&token.len())
        || !token.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("AI 控制授权令牌格式无效".into());
    }

    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&app_data_directory)
        .map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    let config_path = app_data_directory.join(AI_CONTROL_CONFIG_FILE);
    let executable =
        std::env::current_exe().map_err(|error| format!("无法确定 BZ Hub 程序路径：{error}"))?;
    let config = AiControlConfig {
        version: 1,
        enabled,
        token,
        executable: executable.to_string_lossy().into_owned(),
    };
    let contents = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("无法生成 AI 控制配置：{error}"))?;
    fs::write(&config_path, contents).map_err(|error| format!("无法保存 AI 控制配置：{error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("无法保护 AI 控制配置：{error}"))?;
    }

    Ok(config_path.to_string_lossy().into_owned())
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("window-visibility-changed", true);
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            let _ = app.emit("window-visibility-changed", false);
        } else {
            show_main_window(app);
        }
    }
}

#[tauri::command]
fn toggle_window(app: AppHandle) {
    toggle_main_window(&app);
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = app.emit("window-visibility-changed", false);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle, taskbar: State<'_, TaskbarTransparencyController>) {
    taskbar.restore_if_enabled();
    app.exit(0);
}

fn split_command_line(value: &str) -> Result<Vec<String>, String> {
    let characters: Vec<char> = value.chars().collect();
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut index = 0;

    while index < characters.len() {
        let character = characters[index];
        if character.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                arguments.push(std::mem::take(&mut current));
            }
            index += 1;
            continue;
        }

        if character == '"' {
            in_quotes = !in_quotes;
            index += 1;
            continue;
        }

        if character == '\\' {
            let start = index;
            while index < characters.len() && characters[index] == '\\' {
                index += 1;
            }
            let slash_count = index - start;
            if index < characters.len() && characters[index] == '"' {
                current.extend(std::iter::repeat_n('\\', slash_count / 2));
                if slash_count % 2 == 0 {
                    in_quotes = !in_quotes;
                } else {
                    current.push('"');
                }
                index += 1;
            } else {
                current.extend(std::iter::repeat_n('\\', slash_count));
            }
            continue;
        }

        current.push(character);
        index += 1;
    }

    if in_quotes {
        return Err("启动命令中的引号没有闭合".into());
    }
    if !current.is_empty() {
        arguments.push(current);
    }
    Ok(arguments)
}

fn application_command_parts(value: &str) -> Result<(String, Vec<String>), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("应用目标不能为空".into());
    }

    if trimmed.starts_with('"') {
        let mut arguments = split_command_line(trimmed)?;
        if arguments.is_empty() {
            return Err("应用目标不能为空".into());
        }
        let program = arguments.remove(0);
        return Ok((program, arguments));
    }

    let lower = trimmed.to_ascii_lowercase();
    let executable_end = [".exe", ".com", ".bat", ".cmd", ".lnk", ".app"]
        .iter()
        .filter_map(|extension| {
            lower.match_indices(extension).find_map(|(start, matched)| {
                let end = start + matched.len();
                let followed_by_separator = lower
                    .get(end..)
                    .and_then(|rest| rest.chars().next())
                    .is_none_or(char::is_whitespace);
                followed_by_separator.then_some(end)
            })
        })
        .min();

    if let Some(end) = executable_end {
        let program = trimmed[..end].trim().to_string();
        let arguments = split_command_line(trimmed[end..].trim())?;
        return Ok((program, arguments));
    }

    let mut arguments = split_command_line(trimmed)?;
    if arguments.is_empty() {
        return Err("应用目标不能为空".into());
    }
    let program = arguments.remove(0);
    Ok((program, arguments))
}

#[cfg(target_os = "windows")]
fn windows_application_command(program: &str, arguments: &[String]) -> Command {
    let mut command = Command::new(program);
    command.args(arguments).creation_flags(CREATE_NO_WINDOW);

    // A number of Windows launchers resolve sibling DLLs and resources relative
    // to their working directory. Keep that directory Unicode-safe by passing the
    // Path directly to CreateProcessW through std::process::Command.
    if let Some(parent) = Path::new(program)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        command.current_dir(parent);
    }

    command
}

#[cfg(target_os = "windows")]
fn quote_windows_argument(argument: &str) -> String {
    if !argument.is_empty()
        && !argument
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return argument.to_string();
    }

    let mut quoted = String::from("\"");
    let mut backslashes = 0;
    for character in argument.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }

        if character == '"' {
            quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.extend(std::iter::repeat_n('\\', backslashes));
            quoted.push(character);
        }
        backslashes = 0;
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

#[cfg(target_os = "windows")]
fn windows_parameter_line(arguments: &[String]) -> String {
    arguments
        .iter()
        .map(|argument| quote_windows_argument(argument))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "windows")]
fn wide_null(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn launch_application_elevated(program: &str, arguments: &[String]) -> Result<(), String> {
    let verb = wide_null("runas");
    let program_wide = wide_null(program);
    let parameters = windows_parameter_line(arguments);
    let parameters_wide = wide_null(&parameters);
    let directory = Path::new(program)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(wide_null);

    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(program_wide.as_ptr()),
            if parameters.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(parameters_wide.as_ptr())
            },
            directory
                .as_ref()
                .map_or_else(PCWSTR::null, |value| PCWSTR(value.as_ptr())),
            SW_SHOWNORMAL,
        )
    };
    let result_code = result.0 as usize;
    if result_code > 32 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if result_code == 5 || error.raw_os_error() == Some(1223) {
        Err("已取消管理员权限确认".into())
    } else {
        Err(format!(
            "无法以管理员身份启动应用（系统错误 {result_code}）：{error}"
        ))
    }
}

fn launch_application(target: &str, explicit_arguments: Option<&str>) -> Result<(), String> {
    let (program, arguments) = if let Some(arguments) = explicit_arguments {
        (
            target.trim().to_string(),
            split_command_line(arguments.trim())?,
        )
    } else {
        application_command_parts(target)?
    };
    #[cfg(target_os = "windows")]
    {
        let is_shortcut = Path::new(&program)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"));

        if is_shortcut && arguments.is_empty() {
            open::that(&program).map_err(|error| format!("无法打开快捷方式：{error}"))?;
        } else {
            match windows_application_command(&program, &arguments).spawn() {
                Ok(_) => {}
                Err(error) if error.raw_os_error() == Some(740) => {
                    launch_application_elevated(&program, &arguments)?;
                }
                Err(error) => return Err(format!("无法启动应用：{error}")),
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if arguments.is_empty() {
            open::that(&program).map_err(|error| format!("无法打开目标：{error}"))?;
        } else if program.to_ascii_lowercase().ends_with(".app") {
            Command::new("/usr/bin/open")
                .arg(&program)
                .arg("--args")
                .args(&arguments)
                .spawn()
                .map_err(|error| format!("无法启动应用：{error}"))?;
        } else {
            Command::new(&program)
                .args(&arguments)
                .spawn()
                .map_err(|error| format!("无法启动应用：{error}"))?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if arguments.is_empty() {
            open::that(&program).map_err(|error| format!("无法打开目标：{error}"))?;
        } else {
            Command::new(&program)
                .args(&arguments)
                .spawn()
                .map_err(|error| format!("无法启动应用：{error}"))?;
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn resolve_wallpaper_engine_binary(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请先选择 Wallpaper Engine 的 launcher.exe".into());
    }

    let selected = PathBuf::from(trimmed);
    let mut candidates = Vec::new();
    if selected.is_dir() {
        candidates.push(selected.join("wallpaper64.exe"));
        candidates.push(selected.join("wallpaper32.exe"));
    } else {
        let name = selected
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if name == "launcher.exe" {
            if let Some(parent) = selected.parent() {
                candidates.push(parent.join("wallpaper64.exe"));
                candidates.push(parent.join("wallpaper32.exe"));
            }
        } else if name == "wallpaper64.exe" || name == "wallpaper32.exe" {
            candidates.push(selected.clone());
        } else if selected.is_file() {
            candidates.push(selected.clone());
        } else if let Some(parent) = selected.parent() {
            candidates.push(parent.join("wallpaper64.exe"));
            candidates.push(parent.join("wallpaper32.exe"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "没有找到 wallpaper64.exe 或 wallpaper32.exe，请选择 Wallpaper Engine 安装目录或 launcher.exe".into()
        })
}

#[cfg(target_os = "windows")]
fn wallpaper_engine_candidates() -> Vec<PathBuf> {
    const RELATIVE_PATHS: [&str; 4] = [
        r"Program Files (x86)\Steam\steamapps\common\wallpaper_engine\launcher.exe",
        r"Program Files\Steam\steamapps\common\wallpaper_engine\launcher.exe",
        r"SteamLibrary\steamapps\common\wallpaper_engine\launcher.exe",
        r"game\steam\steamapps\common\wallpaper_engine\launcher.exe",
    ];

    (b'C'..=b'Z')
        .flat_map(|drive| {
            RELATIVE_PATHS
                .map(move |relative| PathBuf::from(format!("{}:\\", drive as char)).join(relative))
        })
        .collect()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn detect_wallpaper_engine() -> Option<String> {
    wallpaper_engine_candidates()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn detect_wallpaper_engine() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn open_wallpaper(engine_path: String, project_path: String) -> Result<(), String> {
    let selected_project = PathBuf::from(project_path.trim());
    let project_file = if selected_project.is_dir() {
        selected_project.join("index.html")
    } else {
        selected_project
    };
    if !project_file.is_file() {
        return Err("Wallpaper Engine 项目中没有找到 index.html".into());
    }

    let control_binary = resolve_wallpaper_engine_binary(&engine_path)?;
    if let Some(parent) = control_binary.parent() {
        let launcher = parent.join("launcher.exe");
        if launcher.is_file() {
            let launcher_string = launcher.to_string_lossy().into_owned();
            let _ = windows_application_command(&launcher_string, &[]).spawn();
            std::thread::sleep(Duration::from_millis(900));
        }
    }

    let control_string = control_binary.to_string_lossy().into_owned();
    let arguments = vec![
        "-control".to_string(),
        "openWallpaper".to_string(),
        "-file".to_string(),
        project_file.to_string_lossy().into_owned(),
    ];
    windows_application_command(&control_string, &arguments)
        .spawn()
        .map_err(|error| format!("无法控制 Wallpaper Engine：{error}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn open_wallpaper(_engine_path: String, _project_path: String) -> Result<(), String> {
    Err("Wallpaper Engine 官方目前不支持 macOS".into())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
fn open_wallpaper(_engine_path: String, _project_path: String) -> Result<(), String> {
    Err("当前平台暂不支持 Wallpaper Engine".into())
}

#[tauri::command]
fn launch_target(kind: String, target: String, arguments: Option<String>) -> Result<(), String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("目标地址不能为空".into());
    }

    match kind.as_str() {
        "url" => {
            let parsed = url::Url::parse(trimmed).map_err(|_| "网页地址格式不正确")?;
            match parsed.scheme() {
                "http" | "https" => {
                    open::that(trimmed).map_err(|error| format!("无法打开目标：{error}"))?;
                }
                "file" => {
                    let path = parsed
                        .to_file_path()
                        .map_err(|_| "本地页面地址格式不正确")?;
                    open::that(path).map_err(|error| format!("无法打开目标：{error}"))?;
                }
                _ => return Err("网页地址仅支持 http://、https:// 或 file:///".into()),
            }
        }
        "application" => launch_application(trimmed, arguments.as_deref())?,
        "project" | "folder" | "file" => {
            open::that(trimmed).map_err(|error| format!("无法打开目标：{error}"))?;
        }
        _ => return Err("不支持的入口类型".into()),
    }

    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    let metadata = fs::metadata(file_path).map_err(|error| format!("无法读取导入文件：{error}"))?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("导入文件超过 10 MB，无法处理".into());
    }
    fs::read_to_string(file_path).map_err(|error| format!("无法读取导入文件：{error}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if contents.len() > 10 * 1024 * 1024 {
        return Err("导出内容超过 10 MB，无法保存".into());
    }
    fs::write(Path::new(&path), contents).map_err(|error| format!("无法保存导出文件：{error}"))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn extract_target_icon(target: String) -> Result<Option<String>, String> {
    let (program, _) = application_command_parts(&target)?;
    if !std::path::Path::new(&program).is_file() {
        return Err("请先填写存在的应用文件路径".into());
    }

    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:BZ_HUB_ICON_TARGET)
if ($null -eq $icon) { exit 3 }
$source = $icon.ToBitmap()
$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.DrawImage($source, 0, 0, 64, 64)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
$stream.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$source.Dispose()
$icon.Dispose()
"#;

    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env("BZ_HUB_ICON_TARGET", &program)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("无法读取应用图标：{error}"))?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "这个目标没有可读取的应用图标".into()
        } else {
            format!("无法读取应用图标：{message}")
        });
    }

    let encoded = String::from_utf8(output.stdout).map_err(|_| "应用图标数据格式不正确")?;
    let encoded = encoded.trim();
    if encoded.is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!("data:image/png;base64,{encoded}")))
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn extract_target_icon(target: String) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::time::{SystemTime, UNIX_EPOCH};

    let (program, _) = application_command_parts(&target)?;
    let app_path = Path::new(&program);
    if !app_path.exists() {
        return Err("请先选择存在的应用".into());
    }

    let resources = app_path.join("Contents").join("Resources");
    let info_plist = app_path.join("Contents").join("Info.plist");
    let icon_name = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
        .arg(&info_plist)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let configured_icon = icon_name.map(|name| {
        if name.to_ascii_lowercase().ends_with(".icns") {
            name
        } else {
            format!("{name}.icns")
        }
    });
    let icon_path = configured_icon
        .map(|name| resources.join(name))
        .filter(|path| path.is_file())
        .or_else(|| {
            fs::read_dir(&resources)
                .ok()?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("icns"))
                })
        });
    let Some(icon_path) = icon_path else {
        return Ok(None);
    };

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_png = std::env::temp_dir().join(format!("bz-hub-icon-{nonce}.png"));
    let output = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(&icon_path)
        .arg("--out")
        .arg(&temporary_png)
        .output()
        .map_err(|error| format!("无法转换应用图标：{error}"))?;
    if !output.status.success() {
        return Err("无法转换这个应用的图标".into());
    }
    let bytes = fs::read(&temporary_png).map_err(|error| format!("无法读取应用图标：{error}"))?;
    let _ = fs::remove_file(&temporary_png);
    Ok(Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes)
    )))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
fn extract_target_icon(_target: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[derive(Deserialize)]
struct QWeatherLocation {
    id: String,
    name: String,
    adm1: Option<String>,
}

#[derive(Deserialize)]
struct QWeatherGeoResponse {
    code: String,
    location: Option<Vec<QWeatherLocation>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QWeatherNow {
    temp: String,
    feels_like: String,
    icon: String,
    text: String,
    obs_time: Option<String>,
    wind_dir: Option<String>,
    wind_scale: Option<String>,
    wind_speed: Option<String>,
    humidity: Option<String>,
    precip: Option<String>,
    pressure: Option<String>,
    vis: Option<String>,
    cloud: Option<String>,
    dew: Option<String>,
}

#[derive(Deserialize)]
struct QWeatherNowResponse {
    code: String,
    now: Option<QWeatherNow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QWeatherSnapshot {
    city: String,
    temperature: f64,
    apparent_temperature: f64,
    weather_code: String,
    label: String,
    observed_at: Option<String>,
    wind_direction: Option<String>,
    wind_scale: Option<String>,
    wind_speed: Option<String>,
    humidity: Option<String>,
    precipitation: Option<String>,
    pressure: Option<String>,
    visibility: Option<String>,
    cloud_cover: Option<String>,
    dew_point: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChinaHolidayDay {
    name: String,
    date: String,
    is_off_day: bool,
}

#[derive(Deserialize, Serialize)]
struct ChinaHolidayYear {
    year: u16,
    papers: Vec<String>,
    days: Vec<ChinaHolidayDay>,
}

#[tauri::command]
async fn fetch_china_holidays(year: u16) -> Result<ChinaHolidayYear, String> {
    if !(2007..=2100).contains(&year) {
        return Err("节假日年份超出支持范围".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("BZ-Hub/0.1")
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("无法初始化节假日服务：{error}"))?;
    let response = client
        .get(format!(
            "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json"
        ))
        .send()
        .await
        .map_err(|error| format!("无法连接节假日服务：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("节假日服务返回错误（{}）", status.as_u16()));
    }

    let result: ChinaHolidayYear = response
        .json()
        .await
        .map_err(|error| format!("节假日数据格式不正确：{error}"))?;
    let expected_prefix = format!("{year}-");
    let valid = result.year == year
        && result.days.len() <= 400
        && result.days.iter().all(|day| {
            !day.name.trim().is_empty()
                && day.name.chars().count() <= 32
                && day.date.len() == 10
                && day.date.starts_with(&expected_prefix)
        });
    if !valid {
        return Err("节假日数据校验失败".into());
    }

    Ok(result)
}

fn normalize_qweather_host(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("请填写和风天气 API Host".into());
    }
    let candidate = if trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = url::Url::parse(&candidate).map_err(|_| "API Host 格式不正确")?;
    let host = parsed.host_str().ok_or("API Host 格式不正确")?;
    if parsed.scheme() != "https"
        || !host.ends_with(".qweatherapi.com")
        || (parsed.path() != "/" && !parsed.path().is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("请填写控制台中的专属 qweatherapi.com API Host".into());
    }
    Ok(format!("https://{host}"))
}

fn qweather_error(code: &str) -> String {
    match code {
        "204" => "没有找到该城市".into(),
        "400" => "和风天气请求参数不正确".into(),
        "401" => "和风天气 API Key 或 API Host 不正确".into(),
        "402" | "429" => "和风天气请求额度已用完或请求过于频繁".into(),
        "403" => "当前和风天气凭据没有此服务权限".into(),
        "404" => "和风天气服务地址不存在".into(),
        _ => format!("和风天气返回错误代码 {code}"),
    }
}

#[tauri::command]
async fn fetch_qweather_weather(
    api_host: String,
    api_key: String,
    city: String,
) -> Result<QWeatherSnapshot, String> {
    let host = normalize_qweather_host(&api_host)?;
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请填写和风天气 API Key".into());
    }
    let city = city.trim();
    if city.is_empty() {
        return Err("请先设置天气城市".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("BZ-Hub/0.1")
        .build()
        .map_err(|error| format!("无法初始化天气服务：{error}"))?;

    let geo_response = client
        .get(format!("{host}/geo/v2/city/lookup"))
        .header("X-QW-Api-Key", key)
        .query(&[("location", city), ("number", "1"), ("lang", "zh")])
        .send()
        .await
        .map_err(|error| format!("无法连接和风天气：{error}"))?;
    let geo_status = geo_response.status();
    let geo_text = geo_response
        .text()
        .await
        .map_err(|error| format!("无法读取城市查询结果：{error}"))?;
    if !geo_status.is_success() {
        return Err(qweather_error(geo_status.as_str()));
    }
    let geo: QWeatherGeoResponse = serde_json::from_str(&geo_text)
        .map_err(|error| format!("城市查询数据格式不正确：{error}"))?;
    if geo.code != "200" {
        return Err(qweather_error(&geo.code));
    }
    let location = geo
        .location
        .and_then(|locations| locations.into_iter().next())
        .ok_or_else(|| format!("没有找到城市“{city}”"))?;

    let weather_response = client
        .get(format!("{host}/v7/weather/now"))
        .header("X-QW-Api-Key", key)
        .query(&[("location", location.id.as_str()), ("lang", "zh")])
        .send()
        .await
        .map_err(|error| format!("无法连接和风天气：{error}"))?;
    let weather_status = weather_response.status();
    if !weather_status.is_success() {
        return Err(qweather_error(weather_status.as_str()));
    }
    let current: QWeatherNowResponse = weather_response
        .json()
        .await
        .map_err(|error| format!("实时天气数据格式不正确：{error}"))?;
    if current.code != "200" {
        return Err(qweather_error(&current.code));
    }
    let now = current.now.ok_or("实时天气数据缺少 now 字段")?;
    let temperature = now.temp.parse::<f64>().map_err(|_| "实时温度格式不正确")?;
    let apparent_temperature = now
        .feels_like
        .parse::<f64>()
        .map_err(|_| "体感温度格式不正确")?;

    let city_label = match location.adm1 {
        Some(adm1) if adm1 != location.name => format!("{} · {adm1}", location.name),
        _ => location.name,
    };
    Ok(QWeatherSnapshot {
        city: city_label,
        temperature,
        apparent_temperature,
        weather_code: now.icon,
        label: now.text,
        observed_at: now.obs_time,
        wind_direction: now.wind_dir,
        wind_scale: now.wind_scale,
        wind_speed: now.wind_speed,
        humidity: now.humidity,
        precipitation: now.precip,
        pressure: now.pressure,
        visibility: now.vis,
        cloud_cover: now.cloud,
        dew_point: now.dew,
    })
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开 BZ Hub", true, None::<&str>)?;
    let add = MenuItem::with_id(app, "add", "添加入口", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "立即同步", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &add, &sync, &settings, &quit])?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("BZ Hub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "add" => {
                show_main_window(app);
                let _ = app.emit("open-item-editor", ());
            }
            "sync" => {
                show_main_window(app);
                let _ = app.emit("sync-now", ());
            }
            "settings" => {
                show_main_window(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => {
                show_main_window(app);
                let _ = app.emit("request-quit", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(KeepAwakeController::new())
        .manage(TaskbarTransparencyController::new())
        .manage(AiControlQueue::default())
        .manage(WallpaperBridge::new())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !queue_ai_control_args(app, &args) {
                show_main_window(app);
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            setup_tray(app)?;
            app.state::<WallpaperBridge>().start();

            let args: Vec<String> = std::env::args().collect();
            let started_by_ai = queue_ai_control_args(app.handle(), &args);
            let started_hidden =
                started_by_ai || args.iter().any(|argument| argument == "--hidden");
            if !started_hidden {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("request-close-choice", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            recycle_bin::open_recycle_bin,
            recycle_bin::empty_recycle_bin,
            launch_target,
            detect_wallpaper_engine,
            open_wallpaper,
            extract_target_icon,
            read_text_file,
            write_text_file,
            wallpaper_bridge_info,
            set_wallpaper_weather,
            configure_wallpaper_project,
            fetch_qweather_weather,
            fetch_china_holidays,
            toggle_window,
            hide_window,
            set_keep_awake,
            set_taskbar_transparent,
            take_ai_control_requests,
            complete_ai_control_request,
            configure_ai_control,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while running BZ Hub");

    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
            show_main_window(app);
            let _ = app.emit("request-quit", ());
        }
    });
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{
        ai_control_paths_from_args, ai_control_response_path, application_command_parts,
        split_command_line, validate_ai_control_filename,
    };

    #[cfg(target_os = "windows")]
    use super::{
        quote_windows_argument, taskbar_accent_policy, windows_application_command,
        windows_parameter_line, ACCENT_DISABLED, ACCENT_ENABLE_TRANSPARENT_GRADIENT,
        FULLY_TRANSPARENT_WHITE_ABGR,
    };

    #[test]
    fn parses_unquoted_windows_executable_with_arguments() {
        let (program, arguments) = application_command_parts(
            r#"F:\Games\Example_Game\launcher.exe --open --channel stable"#,
        )
        .expect("command should parse");
        assert_eq!(program, r#"F:\Games\Example_Game\launcher.exe"#);
        assert_eq!(arguments, ["--open", "--channel", "stable"]);
    }

    #[test]
    fn parses_quoted_executable_and_quoted_argument() {
        let (program, arguments) = application_command_parts(
            r#""C:\Program Files\Demo App\demo.exe" --profile "Daily Work""#,
        )
        .expect("command should parse");
        assert_eq!(program, r#"C:\Program Files\Demo App\demo.exe"#);
        assert_eq!(arguments, ["--profile", "Daily Work"]);
    }

    #[test]
    fn preserves_unicode_and_spaces_in_windows_executable_path() {
        let target = r#"G:\Program Files (x86)\示例工具\工具.exe"#;
        let (program, arguments) = application_command_parts(target).expect("command should parse");
        assert_eq!(program, target);
        assert!(arguments.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn launches_windows_executable_directly_from_its_parent_directory() {
        use std::{ffi::OsStr, path::Path};

        let target = r#"G:\Program Files (x86)\示例工具\工具.exe"#;
        let command = windows_application_command(target, &[]);
        assert_eq!(command.get_program(), OsStr::new(target));
        assert_eq!(
            command.get_current_dir(),
            Some(Path::new(r#"G:\Program Files (x86)\示例工具"#))
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn quotes_elevated_windows_arguments_without_losing_spaces_or_backslashes() {
        assert_eq!(quote_windows_argument("--open"), "--open");
        assert_eq!(quote_windows_argument("Daily Work"), r#""Daily Work""#);
        assert_eq!(quote_windows_argument(""), "\"\"");
        assert_eq!(
            quote_windows_argument(r#"say "hello""#),
            r#""say \"hello\"""#
        );
        assert_eq!(
            quote_windows_argument("C:\\Project Files\\"),
            "\"C:\\Project Files\\\\\""
        );
        assert_eq!(
            windows_parameter_line(&["--profile".into(), "Daily Work".into(), "路径 参数".into(),]),
            r#"--profile "Daily Work" "路径 参数""#
        );
    }

    #[test]
    fn preserves_backslashes_in_paths() {
        assert_eq!(
            split_command_line(r#"--output "D:\Project Files\result.txt""#)
                .expect("arguments should parse"),
            ["--output", r#"D:\Project Files\result.txt"#]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn taskbar_switch_maps_to_default_and_fully_transparent_policies() {
        let default = taskbar_accent_policy(false);
        assert_eq!(default.accent_state, ACCENT_DISABLED);
        assert_eq!(default.accent_flags, 0);

        let transparent = taskbar_accent_policy(true);
        assert_eq!(transparent.accent_state, ACCENT_ENABLE_TRANSPARENT_GRADIENT);
        assert_eq!(transparent.accent_flags, 2);
        assert_eq!(transparent.gradient_color, FULLY_TRANSPARENT_WHITE_ABGR);
    }

    #[test]
    fn parses_ai_control_argument_without_treating_normal_start_as_control() {
        assert!(ai_control_paths_from_args(&["bz-hub".into(), "--hidden".into()]).is_empty());
        assert_eq!(
            ai_control_paths_from_args(&[
                "bz-hub".into(),
                "--bz-hub-control".into(),
                r#"C:\Temp\bz-hub-ai-12345678.request.json"#.into(),
            ]),
            [PathBuf::from(r#"C:\Temp\bz-hub-ai-12345678.request.json"#)]
        );
    }

    #[test]
    fn derives_ai_control_response_filename_safely() {
        let request = PathBuf::from("/tmp/bz-hub-ai-12345678.request.json");
        assert_eq!(validate_ai_control_filename(&request).unwrap(), "12345678");
        assert_eq!(
            ai_control_response_path(&request).unwrap(),
            PathBuf::from("/tmp/bz-hub-ai-12345678.response.json")
        );
        assert!(validate_ai_control_filename(Path::new("/tmp/other.request.json")).is_err());
    }
}
