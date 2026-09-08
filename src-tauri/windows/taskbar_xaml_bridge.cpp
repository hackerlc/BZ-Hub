#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <ocidl.h>
#include <xamlom.h>

// windows.h defines GetCurrentTime as a macro, while C++/WinRT exposes methods
// with the same name in generated projection headers.
#ifdef GetCurrentTime
#undef GetCurrentTime
#endif

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.UI.Xaml.h>
#include <winrt/Windows.UI.Xaml.Media.h>
#include <winrt/Windows.UI.Xaml.Shapes.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cwchar>
#include <iterator>
#include <new>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace wf = winrt::Windows::Foundation;
namespace wux = winrt::Windows::UI::Xaml;
namespace wuxm = winrt::Windows::UI::Xaml::Media;
namespace wuxs = winrt::Windows::UI::Xaml::Shapes;

namespace {

// This CLSID is private to BZ Hub and only identifies the in-process XAML
// diagnostics object created by Windows.UI.Xaml.dll.
constexpr CLSID CLSID_BZHubTaskbarTap = {
    0x51e9b9f3,
    0x9e27,
    0x4f8c,
    {0x9a, 0x4e, 0x7d, 0xa2, 0xa5, 0xe1, 0xc6, 0x31},
};

constexpr wchar_t SHARED_MAPPING_NAME[] =
    L"Local\\BZHub.TaskbarTransparency.XamlBridge.v1";
constexpr std::uint32_t SHARED_MAGIC = 0x425A4854; // "BZHT"
constexpr std::uint32_t SHARED_VERSION = 1;
constexpr ULONGLONG HOST_HEARTBEAT_TIMEOUT_MS = 8'000;
constexpr unsigned int XAML_DIAGNOSTICS_MAX_ATTEMPTS = 60;
constexpr DWORD XAML_DIAGNOSTICS_RETRY_DELAY_MS = 500;
constexpr DWORD APPLY_WAIT_MS = 35'000;

struct alignas(64) SharedState {
    std::uint32_t magic;
    std::uint32_t version;
    volatile LONG enabled;
    volatile LONG generation;
    volatile LONG owner_pid;
    volatile LONG bridge_pid;
    volatile LONG ready;
    volatile LONG applied_elements;
    volatile LONG last_hresult;
    alignas(8) volatile LONG64 heartbeat_ms;
};

HMODULE g_module = nullptr;
volatile LONG g_initialize_started = 0;
HANDLE g_host_mapping = nullptr;
SharedState* g_host_state = nullptr;

LONG atomic_read(volatile LONG* value) noexcept {
    return InterlockedCompareExchange(value, 0, 0);
}

LONG64 atomic_read64(volatile LONG64* value) noexcept {
    return InterlockedCompareExchange64(value, 0, 0);
}

void write_message(wchar_t* buffer, std::uint32_t buffer_length,
                   const std::wstring& value) noexcept {
    if (!buffer || buffer_length == 0) {
        return;
    }
    wcsncpy_s(buffer, buffer_length, value.c_str(), _TRUNCATE);
}

std::wstring format_hresult(const wchar_t* prefix, HRESULT value) {
    wchar_t system_message[512]{};
    const DWORD length = FormatMessageW(
        FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        static_cast<DWORD>(value),
        MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        system_message,
        static_cast<DWORD>(std::size(system_message)),
        nullptr);
    while (length > 0 &&
           (system_message[wcslen(system_message) - 1] == L'\r' ||
            system_message[wcslen(system_message) - 1] == L'\n')) {
        system_message[wcslen(system_message) - 1] = L'\0';
    }

    wchar_t code[24]{};
    swprintf_s(code, L"0x%08X", static_cast<unsigned int>(value));
    std::wstring result(prefix);
    result.append(L"（").append(code).append(L"）");
    if (system_message[0] != L'\0') {
        result.append(L"：").append(system_message);
    }
    return result;
}

bool is_windows_11_or_later() noexcept {
    using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOW*);
    const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll) {
        return true;
    }
    const auto rtl_get_version = reinterpret_cast<RtlGetVersionFn>(
        GetProcAddress(ntdll, "RtlGetVersion"));
    if (!rtl_get_version) {
        return true;
    }
    OSVERSIONINFOW version{};
    version.dwOSVersionInfoSize = sizeof(version);
    return rtl_get_version(&version) >= 0 && version.dwBuildNumber >= 22'000;
}

bool ensure_host_mapping(std::wstring& error) noexcept {
    if (g_host_state) {
        return true;
    }

    g_host_mapping = CreateFileMappingW(
        INVALID_HANDLE_VALUE,
        nullptr,
        PAGE_READWRITE,
        0,
        static_cast<DWORD>(sizeof(SharedState)),
        SHARED_MAPPING_NAME);
    if (!g_host_mapping) {
        error = format_hresult(L"无法创建任务栏透明通信区", HRESULT_FROM_WIN32(GetLastError()));
        return false;
    }

    g_host_state = static_cast<SharedState*>(MapViewOfFile(
        g_host_mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(SharedState)));
    if (!g_host_state) {
        error = format_hresult(L"无法访问任务栏透明通信区", HRESULT_FROM_WIN32(GetLastError()));
        CloseHandle(g_host_mapping);
        g_host_mapping = nullptr;
        return false;
    }

    if (g_host_state->magic != SHARED_MAGIC ||
        g_host_state->version != SHARED_VERSION) {
        ZeroMemory(g_host_state, sizeof(SharedState));
        g_host_state->magic = SHARED_MAGIC;
        g_host_state->version = SHARED_VERSION;
    }
    return true;
}

struct BstrOwner {
    BSTR value;
    ~BstrOwner() {
        if (value) {
            SysFreeString(value);
        }
    }
};

struct ShapeState {
    InstanceHandle handle{};
    wuxs::Shape shape{nullptr};
    wuxm::Brush original_fill{nullptr};
    wuxm::Brush transparent_fill{nullptr};
    bool original_captured{false};
    bool transparent_applied{false};
};

class TaskbarTap
    : public winrt::implements<TaskbarTap,
                               IObjectWithSite,
                               IVisualTreeServiceCallback2,
                               winrt::non_agile> {
public:
    TaskbarTap() = default;

    HRESULT STDMETHODCALLTYPE SetSite(IUnknown* site) noexcept override {
        try {
            if (!site) {
                restore_all();
                stop_timer();
                diagnostics_ = nullptr;
                visual_tree_ = nullptr;
                return S_OK;
            }

            winrt::com_ptr<IUnknown> site_unknown;
            site_unknown.copy_from(site);
            diagnostics_ = site_unknown.as<IXamlDiagnostics>();
            visual_tree_ = site_unknown.as<IVisualTreeService>();

            mapping_ = OpenFileMappingW(
                FILE_MAP_ALL_ACCESS, FALSE, SHARED_MAPPING_NAME);
            if (!mapping_) {
                return HRESULT_FROM_WIN32(GetLastError());
            }
            state_ = static_cast<SharedState*>(MapViewOfFile(
                mapping_, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(SharedState)));
            if (!state_) {
                return HRESULT_FROM_WIN32(GetLastError());
            }
            if (state_->magic != SHARED_MAGIC ||
                state_->version != SHARED_VERSION) {
                return HRESULT_FROM_WIN32(ERROR_REVISION_MISMATCH);
            }

            InterlockedExchange(&state_->bridge_pid,
                                static_cast<LONG>(GetCurrentProcessId()));
            InterlockedExchange(&state_->ready, 1);
            InterlockedExchange(&state_->last_hresult, S_OK);

            auto self = get_strong();
            std::thread([self = std::move(self)]() mutable {
                const HRESULT result =
                    self->visual_tree_->AdviseVisualTreeChange(self.get());
                if (self->state_) {
                    if (FAILED(result)) {
                        InterlockedExchange(&self->state_->last_hresult, result);
                        InterlockedExchange(&self->state_->ready, 0);
                    } else {
                        InterlockedExchange(&self->state_->ready, 2);
                    }
                }
            }).detach();
            return S_OK;
        } catch (...) {
            const HRESULT result = winrt::to_hresult();
            if (state_) {
                InterlockedExchange(&state_->last_hresult, result);
                InterlockedExchange(&state_->ready, 0);
            }
            return result;
        }
    }

    HRESULT STDMETHODCALLTYPE GetSite(REFIID iid, void** result) noexcept override {
        if (!result) {
            return E_POINTER;
        }
        *result = nullptr;
        if (!diagnostics_) {
            return E_FAIL;
        }
        return diagnostics_->QueryInterface(iid, result);
    }

    HRESULT STDMETHODCALLTYPE OnVisualTreeChange(
        ParentChildRelation relation,
        VisualElement element,
        VisualMutationType mutation_type) noexcept override {
        BstrOwner filename{element.SrcInfo.FileName};
        BstrOwner hash{element.SrcInfo.Hash};
        BstrOwner type{element.Type};
        BstrOwner name{element.Name};

        try {
            ensure_timer();
            if (mutation_type == Add) {
                const std::wstring_view type_name(
                    type.value ? type.value : L"",
                    type.value ? SysStringLen(type.value) : 0);
                const std::wstring_view element_name(
                    name.value ? name.value : L"",
                    name.value ? SysStringLen(name.value) : 0);

                if (type_name == L"Windows.UI.Xaml.Shapes.Rectangle" &&
                    (element_name == L"BackgroundFill" ||
                     element_name == L"BackgroundStroke")) {
                    auto parent = from_handle<wux::FrameworkElement>(relation.Parent);
                    if (belongs_to_taskbar(parent)) {
                        auto shape = from_handle<wuxs::Shape>(element.Handle);
                        remember_shape(element.Handle, std::move(shape));
                        apply_requested_state();
                    }
                }
            } else if (mutation_type == Remove) {
                shapes_.erase(
                    std::remove_if(shapes_.begin(), shapes_.end(),
                                   [element](const ShapeState& item) {
                                       return item.handle == element.Handle;
                                   }),
                    shapes_.end());
                publish_applied_count();
            }
        } catch (...) {
            if (state_) {
                InterlockedExchange(&state_->last_hresult, winrt::to_hresult());
            }
        }
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnElementStateChanged(
        InstanceHandle,
        VisualElementState,
        LPCWSTR) noexcept override {
        return S_OK;
    }

    ~TaskbarTap() {
        if (state_) {
            InterlockedExchange(&state_->applied_elements, 0);
            InterlockedExchange(&state_->ready, 0);
            UnmapViewOfFile(state_);
            state_ = nullptr;
        }
        if (mapping_) {
            CloseHandle(mapping_);
            mapping_ = nullptr;
        }
    }

private:
    template <typename T>
    T from_handle(InstanceHandle handle) {
        wf::IInspectable inspectable{nullptr};
        winrt::check_hresult(diagnostics_->GetIInspectableFromHandle(
            handle,
            reinterpret_cast<::IInspectable**>(winrt::put_abi(inspectable))));
        return inspectable.as<T>();
    }

    bool belongs_to_taskbar(wux::FrameworkElement element) {
        for (unsigned int depth = 0; element && depth < 64; ++depth) {
            if (element.Name() == L"TaskbarFrame" ||
                winrt::get_class_name(element) == L"Taskbar.TaskbarFrame") {
                return true;
            }
            element = wuxm::VisualTreeHelper::GetParent(element)
                          .try_as<wux::FrameworkElement>();
        }
        return false;
    }

    void remember_shape(InstanceHandle handle, wuxs::Shape shape) {
        const auto existing = std::find_if(
            shapes_.begin(), shapes_.end(),
            [handle](const ShapeState& item) { return item.handle == handle; });
        if (existing == shapes_.end()) {
            ShapeState item;
            item.handle = handle;
            item.shape = std::move(shape);
            shapes_.push_back(std::move(item));
        }
    }

    bool host_is_alive() const noexcept {
        if (!state_) {
            return false;
        }
        const LONG owner_pid = atomic_read(&state_->owner_pid);
        const LONG64 heartbeat = atomic_read64(&state_->heartbeat_ms);
        const ULONGLONG now = GetTickCount64();
        if (owner_pid <= 0 || heartbeat <= 0 ||
            now > static_cast<ULONGLONG>(heartbeat) + HOST_HEARTBEAT_TIMEOUT_MS) {
            return false;
        }

        const HANDLE process = OpenProcess(SYNCHRONIZE, FALSE,
                                           static_cast<DWORD>(owner_pid));
        if (!process) {
            // An elevated BZ Hub cannot always be queried from Explorer. The
            // heartbeat still provides bounded recovery if it disappears.
            return true;
        }
        const DWORD wait_result = WaitForSingleObject(process, 0);
        CloseHandle(process);
        return wait_result == WAIT_TIMEOUT;
    }

    void ensure_timer() {
        if (timer_) {
            return;
        }
        timer_ = wux::DispatcherTimer();
        timer_.Interval(wf::TimeSpan{2'500'000}); // 250 ms
        timer_token_ = timer_.Tick([weak = get_weak()](const auto&, const auto&) {
            if (const auto self = weak.get()) {
                self->apply_requested_state();
            }
        });
        timer_.Start();
    }

    void stop_timer() noexcept {
        try {
            if (timer_) {
                timer_.Stop();
                if (timer_token_.value != 0) {
                    timer_.Tick(timer_token_);
                }
                timer_ = nullptr;
                timer_token_ = {};
            }
        } catch (...) {
        }
    }

    void apply_requested_state() noexcept {
        try {
            const bool requested = state_ &&
                atomic_read(&state_->enabled) != 0 && host_is_alive();
            if (requested) {
                apply_transparent();
            } else {
                restore_all();
            }
            publish_applied_count();
            if (state_) {
                InterlockedExchange(&state_->last_hresult, S_OK);
            }
        } catch (...) {
            if (state_) {
                InterlockedExchange(&state_->last_hresult, winrt::to_hresult());
            }
        }
    }

    void apply_transparent() {
        for (auto& item : shapes_) {
            if (!item.shape) {
                continue;
            }

            const auto current = item.shape.Fill();
            if (!item.transparent_applied ||
                winrt::get_abi(current) != winrt::get_abi(item.transparent_fill)) {
                item.original_fill = current;
                item.original_captured = true;
            }

            if (!item.transparent_fill) {
                winrt::Windows::UI::Color transparent{};
                transparent.A = 0;
                transparent.R = 0;
                transparent.G = 0;
                transparent.B = 0;
                item.transparent_fill = wuxm::SolidColorBrush(transparent);
            }
            if (winrt::get_abi(current) != winrt::get_abi(item.transparent_fill)) {
                item.shape.Fill(item.transparent_fill);
            }
            item.transparent_applied = true;
        }
    }

    void restore_all() noexcept {
        for (auto& item : shapes_) {
            if (!item.shape || !item.transparent_applied) {
                continue;
            }
            try {
                if (item.original_captured) {
                    item.shape.Fill(item.original_fill);
                }
                item.transparent_applied = false;
            } catch (...) {
            }
        }
    }

    void publish_applied_count() noexcept {
        if (!state_) {
            return;
        }
        LONG count = 0;
        for (const auto& item : shapes_) {
            if (item.transparent_applied) {
                ++count;
            }
        }
        InterlockedExchange(&state_->applied_elements, count);
    }

    winrt::com_ptr<IXamlDiagnostics> diagnostics_;
    winrt::com_ptr<IVisualTreeService> visual_tree_;
    HANDLE mapping_ = nullptr;
    SharedState* state_ = nullptr;
    wux::DispatcherTimer timer_{nullptr};
    winrt::event_token timer_token_{};
    std::vector<ShapeState> shapes_;
};

class TaskbarTapFactory final : public IClassFactory {
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) noexcept override {
        if (!result) {
            return E_POINTER;
        }
        *result = nullptr;
        if (iid == IID_IUnknown || iid == IID_IClassFactory) {
            *result = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() noexcept override {
        return ++references_;
    }

    ULONG STDMETHODCALLTYPE Release() noexcept override {
        const ULONG remaining = --references_;
        if (remaining == 0) {
            delete this;
        }
        return remaining;
    }

    HRESULT STDMETHODCALLTYPE CreateInstance(
        IUnknown* outer,
        REFIID iid,
        void** result) noexcept override {
        if (outer) {
            return CLASS_E_NOAGGREGATION;
        }
        if (!result) {
            return E_POINTER;
        }
        *result = nullptr;
        try {
            return winrt::make_self<TaskbarTap>().as(iid, result);
        } catch (...) {
            return winrt::to_hresult();
        }
    }

    HRESULT STDMETHODCALLTYPE LockServer(BOOL) noexcept override {
        return S_OK;
    }

private:
    std::atomic<ULONG> references_{1};
};

using InitializeXamlDiagnosticsExFn = HRESULT(WINAPI*)(
    LPCWSTR, DWORD, LPCWSTR, LPCWSTR, CLSID, LPCWSTR);

DWORD WINAPI initialize_xaml_tap(void*) noexcept {
    std::wstring mapping_error;
    if (!ensure_host_mapping(mapping_error)) {
        return 0;
    }

    wchar_t module_path[MAX_PATH]{};
    const DWORD module_path_length =
        GetModuleFileNameW(g_module, module_path, std::size(module_path));
    if (module_path_length == 0 || module_path_length == std::size(module_path)) {
        if (g_host_state) {
            InterlockedExchange(&g_host_state->last_hresult,
                                HRESULT_FROM_WIN32(GetLastError()));
        }
        return 0;
    }

    const HMODULE xaml = LoadLibraryExW(
        L"Windows.UI.Xaml.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!xaml) {
        if (g_host_state) {
            InterlockedExchange(&g_host_state->last_hresult,
                                HRESULT_FROM_WIN32(GetLastError()));
        }
        return 0;
    }
    const auto initialize = reinterpret_cast<InitializeXamlDiagnosticsExFn>(
        GetProcAddress(xaml, "InitializeXamlDiagnosticsEx"));
    if (!initialize) {
        if (g_host_state) {
            InterlockedExchange(&g_host_state->last_hresult,
                                HRESULT_FROM_WIN32(GetLastError()));
        }
        FreeLibrary(xaml);
        return 0;
    }

    HRESULT result = E_FAIL;
    for (unsigned int attempt = 1;
         attempt <= XAML_DIAGNOSTICS_MAX_ATTEMPTS;
         ++attempt) {
        wchar_t connection_name[96]{};
        // Explorer's XAML diagnostics host only recognizes this endpoint
        // family. A custom prefix returns HRESULT_FROM_WIN32(ERROR_NOT_FOUND)
        // even though the target process and injected TAP DLL are valid.
        swprintf_s(connection_name, L"VisualDiagConnection%u", attempt);
        std::thread initialize_attempt([&] {
            result = initialize(connection_name,
                                GetCurrentProcessId(),
                                nullptr,
                                module_path,
                                CLSID_BZHubTaskbarTap,
                                nullptr);
        });
        initialize_attempt.join();
        if (SUCCEEDED(result)) {
            break;
        }
        Sleep(XAML_DIAGNOSTICS_RETRY_DELAY_MS);
    }

    if (g_host_state && FAILED(result)) {
        InterlockedExchange(&g_host_state->last_hresult, result);
    }
    if (FAILED(result)) {
        InterlockedExchange(&g_initialize_started, 0);
    }
    FreeLibrary(xaml);
    return 0;
}

} // namespace

extern "C" __declspec(dllexport) LRESULT CALLBACK
BZHubTaskbarHookProc(int code, WPARAM wparam, LPARAM lparam) noexcept {
    if (code >= HC_ACTION &&
        InterlockedCompareExchange(&g_initialize_started, 1, 0) == 0) {
        HMODULE pinned = nullptr;
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
            reinterpret_cast<LPCWSTR>(&BZHubTaskbarHookProc),
            &pinned);
        const HANDLE thread = CreateThread(
            nullptr, 0, initialize_xaml_tap, nullptr, 0, nullptr);
        if (thread) {
            CloseHandle(thread);
        } else {
            InterlockedExchange(&g_initialize_started, 0);
        }
    }
    return CallNextHookEx(nullptr, code, wparam, lparam);
}

extern "C" __declspec(dllexport) int WINAPI
BZHubTaskbarSetEnabled(int enabled,
                       wchar_t* message,
                       std::uint32_t message_length) noexcept {
    if (!is_windows_11_or_later()) {
        return 1; // Ask the Rust host to use the Windows 10 accent-policy path.
    }

    std::wstring error;
    if (!ensure_host_mapping(error)) {
        write_message(message, message_length, error);
        return 2;
    }

    InterlockedExchange(&g_host_state->owner_pid,
                        static_cast<LONG>(GetCurrentProcessId()));
    InterlockedExchange64(&g_host_state->heartbeat_ms,
                          static_cast<LONG64>(GetTickCount64()));
    InterlockedIncrement(&g_host_state->generation);
    InterlockedExchange(&g_host_state->enabled, enabled ? 1 : 0);

    if (!enabled) {
        const ULONGLONG deadline = GetTickCount64() + 1'500;
        while (atomic_read(&g_host_state->applied_elements) != 0 &&
               GetTickCount64() < deadline) {
            Sleep(25);
        }
        return 0;
    }

    const HWND taskbar = FindWindowW(L"Shell_TrayWnd", nullptr);
    if (!taskbar) {
        InterlockedExchange(&g_host_state->enabled, 0);
        write_message(message, message_length,
                      L"没有找到 Windows 任务栏，Explorer 可能正在重启");
        return 2;
    }

    DWORD explorer_pid = 0;
    const DWORD taskbar_thread =
        GetWindowThreadProcessId(taskbar, &explorer_pid);
    if (!taskbar_thread || !explorer_pid) {
        const HRESULT result = HRESULT_FROM_WIN32(GetLastError());
        InterlockedExchange(&g_host_state->enabled, 0);
        write_message(message, message_length,
                      format_hresult(L"无法读取 Explorer 任务栏线程", result));
        return 2;
    }

    const bool bridge_matches =
        atomic_read(&g_host_state->ready) != 0 &&
        atomic_read(&g_host_state->bridge_pid) == static_cast<LONG>(explorer_pid);
    if (!bridge_matches) {
        InterlockedExchange(&g_host_state->ready, 0);
        InterlockedExchange(&g_host_state->applied_elements, 0);
        InterlockedExchange(&g_host_state->last_hresult, S_OK);

        const HHOOK hook = SetWindowsHookExW(
            WH_CALLWNDPROC,
            BZHubTaskbarHookProc,
            g_module,
            taskbar_thread);
        if (!hook) {
            const HRESULT result = HRESULT_FROM_WIN32(GetLastError());
            InterlockedExchange(&g_host_state->enabled, 0);
            write_message(message, message_length,
                          format_hresult(L"无法将透明模块连接到 Explorer", result));
            return 2;
        }

        DWORD_PTR ignored = 0;
        const LRESULT sent = SendMessageTimeoutW(
            taskbar,
            WM_NULL,
            0,
            0,
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            2'000,
            &ignored);
        UnhookWindowsHookEx(hook);
        if (!sent) {
            const HRESULT result = HRESULT_FROM_WIN32(GetLastError());
            InterlockedExchange(&g_host_state->enabled, 0);
            write_message(message, message_length,
                          format_hresult(L"Explorer 没有响应透明模块", result));
            return 2;
        }
    }

    const ULONGLONG deadline = GetTickCount64() + APPLY_WAIT_MS;
    while (GetTickCount64() < deadline) {
        const LONG ready = atomic_read(&g_host_state->ready);
        const HRESULT last_result =
            static_cast<HRESULT>(atomic_read(&g_host_state->last_hresult));
        if (atomic_read(&g_host_state->bridge_pid) == static_cast<LONG>(explorer_pid) &&
            atomic_read(&g_host_state->applied_elements) > 0) {
            return 0;
        }
        if (FAILED(last_result) && (ready == 0 || ready >= 2)) {
            InterlockedExchange(&g_host_state->enabled, 0);
            write_message(message, message_length,
                          format_hresult(L"Windows XAML 任务栏连接失败", last_result));
            return 2;
        }
        Sleep(50);
    }

    InterlockedExchange(&g_host_state->enabled, 0);
    write_message(message, message_length,
                  L"已连接 Explorer，但未找到可修改的任务栏 XAML 背景");
    return 2;
}

STDAPI DllGetClassObject(REFCLSID class_id,
                         REFIID interface_id,
                         void** result) {
    if (!result) {
        return E_POINTER;
    }
    *result = nullptr;
    if (class_id != CLSID_BZHubTaskbarTap) {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    auto* factory = new (std::nothrow) TaskbarTapFactory();
    if (!factory) {
        return E_OUTOFMEMORY;
    }
    const HRESULT query_result = factory->QueryInterface(interface_id, result);
    factory->Release();
    return query_result;
}

STDAPI DllCanUnloadNow() {
    return S_FALSE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, void*) noexcept {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = instance;
        DisableThreadLibraryCalls(instance);
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_host_state) {
            UnmapViewOfFile(g_host_state);
            g_host_state = nullptr;
        }
        if (g_host_mapping) {
            CloseHandle(g_host_mapping);
            g_host_mapping = nullptr;
        }
    }
    return TRUE;
}
