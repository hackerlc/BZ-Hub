import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock3,
  Cloud,
  CloudOff,
  CloudRain,
  Command,
  Droplets,
  Eye,
  Gauge,
  Grid2X2,
  LayoutGrid,
  LoaderCircle,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import { CloseDialog } from "./components/CloseDialog";
import { RecycleBinButton } from "./components/RecycleBinButton";
import { CalendarPopover } from "./components/CalendarPopover";
import { CalendarPage, type CalendarFocusRequest } from "./components/CalendarPage";
import { NextCalendarHighlight } from "./components/NextCalendarHighlight";
import { LauncherCard, type DropPlacement } from "./components/LauncherCard";
import { ItemEditor } from "./components/ItemEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toast, type ToastMessage } from "./components/Toast";
import { useLauncherState } from "./hooks/useLauncherState";
import { mergeCloudState, toCloudState } from "./lib/cloudMerge";
import { cloudStateFingerprint } from "./lib/cloudFingerprint";
import {
  aiControlFailure,
  aiControlSuccess,
  createAiControlToken,
  hasOwn,
  optionalBoolean,
  optionalInteger,
  optionalString,
  parseAiControlEnvelope,
  requiredString,
  type AiControlResponse,
  type QueuedAiControlRequest,
} from "./lib/aiControl";
import {
  applyLauncherImport,
  createLauncherExport,
  parseLauncherExport,
  type ImportMode,
} from "./lib/dataTransfer";
import { canLaunchAction, launchAction, launchActionsFor, launchItem } from "./lib/launcher";
import { getPlatform, isTauriRuntime, platformLabel } from "./lib/platform";
import { launchItemSearchScore } from "./lib/search";
import { createId } from "./lib/id";
import { NATIVE_DIALOG_STATE_EVENT, setNativeDialogOpen } from "./lib/nativeDialog";
import { saveLauncherState } from "./lib/storage";
import {
  getCloudSession,
  isCloudConfigured,
  sendEmailOtp,
  signOutCloud,
  syncLauncherState,
  verifyEmailLogin,
} from "./lib/supabase";
import { fetchWeather } from "./lib/weather";
import { createWallpaperSnapshot } from "./lib/wallpaper";
import { localDateKey } from "./lib/holidays";
import { compareCalendarEntries, isLocalDateKey } from "./lib/calendarEntries";
import type { CalendarEntry, LaunchAction, LaunchItem, LauncherState, WeatherSnapshot, WindowBounds } from "./types";

type CategoryFilter = "frequent" | "all" | "favorites" | string;
type AutoSyncTrigger = "dataChange" | "networkReconnect" | "windowOpen";

interface WallpaperBridgeInfo {
  available: boolean;
  url?: string;
  port?: number;
}

function greetingFor(hour: number): string {
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function formatWeatherObservation(value?: string): string {
  if (!value) return "观测时间未知";
  const observedAt = new Date(value);
  if (Number.isNaN(observedAt.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(observedAt);
}

function scopeMatches(item: LaunchItem, platform: ReturnType<typeof getPlatform>): boolean {
  if (item.scope === "all" || platform === "web" || platform === "linux") return true;
  return item.scope === platform;
}

const CALENDAR_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function offsetDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function calendarEntryForAi(entry: CalendarEntry, items: LaunchItem[]) {
  const linkedItem = entry.linkedItemId
    ? items.find((item) => item.id === entry.linkedItemId && !item.deletedAt)
    : undefined;
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    time: entry.time ?? null,
    note: entry.note ?? null,
    importance: entry.importance,
    completed: entry.completed,
    linkedItemId: entry.linkedItemId ?? null,
    linkedItemName: linkedItem?.name ?? null,
  };
}

export default function App() {
  const {
    state,
    ready,
    storageError,
    setState,
    upsertItem,
    removeItem,
    reorderItems,
    recordLaunch,
    upsertCalendarEntry,
    removeCalendarEntry,
    toggleCalendarEntry,
    upsertCategory,
    removeCategory,
    updateSharedPreferences,
    updateDevicePreferences,
    replaceState,
  } = useLauncherState();

  const platform = useMemo(getPlatform, []);
  const [now, setNow] = useState(new Date());
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("frequent");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LaunchItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ itemId: string; placement: DropPlacement } | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [windowVisible, setWindowVisible] = useState(true);
  const [keepAwakeBusy, setKeepAwakeBusy] = useState(false);
  const [taskbarTransparencyBusy, setTaskbarTransparencyBusy] = useState(false);
  const [aiControlBusy, setAiControlBusy] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperBridgeInfo, setWallpaperBridgeInfo] = useState<WallpaperBridgeInfo | null>(null);
  const [launchingItemIds, setLaunchingItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [calendarFocusRequest, setCalendarFocusRequest] = useState<CalendarFocusRequest>(() => ({
    id: 0,
    date: localDateKey(new Date()),
  }));
  const searchRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  const syncingRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const activeSyncPromiseRef = useRef<Promise<void> | null>(null);
  const performSyncRef = useRef<((targetSession?: Session | null) => Promise<void>) | null>(null);
  const syncTimerRef = useRef<number | undefined>(undefined);
  const forceSyncTimerRef = useRef(false);
  const lastSyncedFingerprintRef = useRef<string | null>(null);
  const initializedSyncUserRef = useRef<string | null>(null);
  const syncQueuedRef = useRef(false);
  const toastSequence = useRef(0);
  const windowBoundsRef = useRef<WindowBounds | undefined>(state.devicePreferences.windowBounds);
  const lastReorderRef = useRef("");
  const launchLocksRef = useRef(new Set<string>());
  const launchReleaseTimersRef = useRef(new Map<string, number>());
  const nativeDialogOpenRef = useRef(false);
  const aiControlDrainRunningRef = useRef(false);
  const aiControlDrainQueuedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    sessionRef.current = session;
    if (!session) {
      initializedSyncUserRef.current = null;
      lastSyncedFingerprintRef.current = null;
      window.clearTimeout(syncTimerRef.current);
    }
  }, [session]);

  useEffect(() => () => {
    launchReleaseTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    launchReleaseTimersRef.current.clear();
    launchLocksRef.current.clear();
    window.clearTimeout(syncTimerRef.current);
  }, []);

  useEffect(() => {
    const handleNativeDialogState = (event: Event) => {
      nativeDialogOpenRef.current = (event as CustomEvent<boolean>).detail;
    };
    window.addEventListener(NATIVE_DIALOG_STATE_EVENT, handleNativeDialogState);
    return () => window.removeEventListener(NATIVE_DIALOG_STATE_EVENT, handleNativeDialogState);
  }, []);

  const showToast = useCallback((text: string, type: ToastMessage["type"] = "success") => {
    toastSequence.current += 1;
    setToast({ id: toastSequence.current, text, type });
  }, []);

  const commitState = useCallback((nextState: LauncherState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, [setState]);

  useEffect(() => {
    if (storageError) showToast(storageError.message, "error");
  }, [showToast, storageError?.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!windowVisible) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [windowVisible]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_keep_awake", {
        enabled: stateRef.current.devicePreferences.keepAwake,
      }))
      .catch((error) => {
        if (!active) return;
        updateDevicePreferences({ keepAwake: false });
        showToast(`无法恢复保持唤醒状态：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    return () => { active = false; };
  }, [ready, showToast, updateDevicePreferences]);

  useEffect(() => {
    if (!ready || !isTauriRuntime() || platform !== "windows") return;
    if (!stateRef.current.devicePreferences.taskbarTransparent) return;
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_taskbar_transparent", { enabled: true }))
      .catch((error) => {
        if (!active) return;
        updateDevicePreferences({ taskbarTransparent: false });
        showToast(`无法恢复任务栏透明状态：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    return () => { active = false; };
  }, [platform, ready, showToast, updateDevicePreferences]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<WallpaperBridgeInfo>("wallpaper_bridge_info"))
      .then((info) => {
        if (active) setWallpaperBridgeInfo(info);
      })
      .catch((error) => {
        if (active) showToast(`动态桌面天气桥接启动失败：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    return () => { active = false; };
  }, [ready, showToast]);

  useEffect(() => {
    if (!ready || !isTauriRuntime() || state.devicePreferences.wallpaperEnginePath) return;
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string | null>("detect_wallpaper_engine"))
      .then((detected) => {
        if (active && detected && !stateRef.current.devicePreferences.wallpaperEnginePath) {
          updateDevicePreferences({ wallpaperEnginePath: detected });
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [ready, state.devicePreferences.wallpaperEnginePath, updateDevicePreferences]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    const snapshot = JSON.stringify(createWallpaperSnapshot(state.devicePreferences, weather, weatherError));
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => active ? invoke("set_wallpaper_weather", { snapshot }) : undefined)
      .catch((error) => {
        if (active) showToast(`动态桌面数据更新失败：${String(error)}`, "error");
      });
    return () => { active = false; };
  }, [ready, weather, weatherError, state.devicePreferences.wallpaperEnabled,
    state.devicePreferences.wallpaperSimulationEnabled, state.devicePreferences.wallpaperSimulationTime,
    state.devicePreferences.wallpaperSimulationWeather, state.devicePreferences.wallpaperSimulationWindSpeed, showToast]);

  const loadWeather = useCallback(async (force = false) => {
    setWeatherLoading(true);
    setWeatherError("");
    try {
      setWeather(await fetchWeather(
        stateRef.current.sharedPreferences.weatherCity,
        {
          apiHost: stateRef.current.devicePreferences.qweatherApiHost,
          apiKey: stateRef.current.devicePreferences.qweatherApiKey,
        },
        force,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "天气获取失败");
      setWeatherError(message);
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadWeather();
  }, [
    ready,
    state.sharedPreferences.weatherCity,
    state.devicePreferences.qweatherApiHost,
    state.devicePreferences.qweatherApiKey,
    loadWeather,
  ]);

  useEffect(() => {
    if (activeCategory === "frequent" || activeCategory === "all" || activeCategory === "favorites") return;
    const stillExists = state.categories.some((category) => category.id === activeCategory && !category.deletedAt);
    if (!stillExists) setActiveCategory("all");
  }, [activeCategory, state.categories]);

  useEffect(() => {
    if (!isCloudConfigured) return;
    void getCloudSession()
      .then(setSession)
      .catch((error) => showToast(error instanceof Error ? error.message : "读取同步账户失败", "error"));
  }, [showToast]);

  const performSync = useCallback(async (targetSession: Session | null = sessionRef.current) => {
    if (!targetSession) return;
    if (activeSyncPromiseRef.current) {
      syncQueuedRef.current = true;
      await activeSyncPromiseRef.current;
      return;
    }

    const task = (async () => {
      syncingRef.current = true;
      setSyncing(true);
      const submitted = stateRef.current;
      const submittedFingerprint = cloudStateFingerprint(submitted);
      try {
        const synced = await syncLauncherState(submitted, targetSession.user.id);
        const syncedFingerprint = cloudStateFingerprint(synced);
        const latestLocal = stateRef.current;
        const latestFingerprint = cloudStateFingerprint(latestLocal);
        const nextState = latestFingerprint === submittedFingerprint
          ? synced
          : {
              ...mergeCloudState(latestLocal, toCloudState(synced)),
              syncMeta: synced.syncMeta,
            };

        lastSyncedFingerprintRef.current = syncedFingerprint;
        initializedSyncUserRef.current = targetSession.user.id;
        stateRef.current = nextState;
        replaceState(nextState);
        if (cloudStateFingerprint(nextState) !== syncedFingerprint) syncQueuedRef.current = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "同步失败";
        const nextState = {
          ...stateRef.current,
          syncMeta: { ...stateRef.current.syncMeta, enabled: true, lastError: message },
        };
        stateRef.current = nextState;
        setState(nextState);
        throw error;
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    })();

    activeSyncPromiseRef.current = task;
    try {
      await task;
    } finally {
      activeSyncPromiseRef.current = null;
      if (syncQueuedRef.current && sessionRef.current) {
        syncQueuedRef.current = false;
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = window.setTimeout(() => {
          void performSyncRef.current?.().catch((error) => {
            showToast(`自动同步失败：${error instanceof Error ? error.message : String(error)}`, "error");
          });
        }, 500);
      }
    }
  }, [replaceState, setState, showToast]);

  performSyncRef.current = performSync;

  const scheduleSync = useCallback((
    delay = 1_200,
    force = false,
    trigger: AutoSyncTrigger = "dataChange",
  ) => {
    if (!sessionRef.current) return;
    const isEnabled = () => {
      const preferences = stateRef.current.devicePreferences;
      if (trigger === "networkReconnect") return preferences.syncOnNetworkReconnect;
      if (trigger === "windowOpen") return preferences.syncOnWindowOpen;
      return preferences.syncOnDataChange;
    };
    if (!isEnabled()) return;
    forceSyncTimerRef.current ||= force;
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      if (!isEnabled()) {
        forceSyncTimerRef.current = false;
        return;
      }
      const shouldForce = forceSyncTimerRef.current;
      forceSyncTimerRef.current = false;
      if (!shouldForce && cloudStateFingerprint(stateRef.current) === lastSyncedFingerprintRef.current) return;
      void performSyncRef.current?.().catch((error) => {
        showToast(`自动同步失败：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    }, delay);
  }, [showToast]);

  useEffect(() => {
    if (!session || !ready) return;
    if (initializedSyncUserRef.current === session.user.id) return;
    initializedSyncUserRef.current = session.user.id;
    lastSyncedFingerprintRef.current = null;
    void performSync(session).catch((error) => {
      showToast(`首次同步失败：${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, [session?.user.id, ready, performSync, showToast]);

  const currentCloudFingerprint = useMemo(
    () => cloudStateFingerprint(state),
    [state.categories, state.items, state.events, state.calendarEntries, state.sharedPreferences],
  );

  useEffect(() => {
    if (!session || !ready || initializedSyncUserRef.current !== session.user.id) return;
    if (!state.devicePreferences.syncOnDataChange) return;
    if (currentCloudFingerprint === lastSyncedFingerprintRef.current) return;
    scheduleSync();
  }, [
    currentCloudFingerprint,
    ready,
    scheduleSync,
    session?.user.id,
    state.devicePreferences.syncOnDataChange,
  ]);

  useEffect(() => {
    const handleOnline = () => {
      scheduleSync(0, true, "networkReconnect");
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [scheduleSync]);

  const hideWindow = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("hide_window");
      setWindowVisible(false);
    } catch (error) {
      showToast(`无法收起窗口：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [showToast]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let disposed = false;
    let persistTimer: number | undefined;
    const cleanups: Array<() => void> = [];

    void (async () => {
      const windowApi = await import("@tauri-apps/api/window");
      const appWindow = windowApi.getCurrentWindow();
      const saved = stateRef.current.devicePreferences.windowBounds;

      if (saved
        && Number.isFinite(saved.x)
        && Number.isFinite(saved.y)
        && Number.isFinite(saved.width)
        && Number.isFinite(saved.height)) {
        const restored: WindowBounds = {
          ...saved,
          width: Math.max(580, saved.width),
          height: Math.max(560, saved.height),
        };
        await appWindow.setSize(new windowApi.PhysicalSize(restored.width, restored.height));

        const monitors = await windowApi.availableMonitors();
        const isVisible = monitors.some((monitor) => {
          const left = monitor.position.x;
          const top = monitor.position.y;
          const right = left + monitor.size.width;
          const bottom = top + monitor.size.height;
          return restored.x < right - 80
            && restored.x + restored.width > left + 80
            && restored.y < bottom - 50
            && restored.y + restored.height > top + 50;
        });
        if (isVisible) {
          await appWindow.setPosition(new windowApi.PhysicalPosition(restored.x, restored.y));
        }
      }

      if (disposed) return;
      const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
      windowBoundsRef.current = {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };

      const schedulePersist = (patch: Partial<WindowBounds>) => {
        const current = windowBoundsRef.current;
        if (!current) return;
        windowBoundsRef.current = { ...current, ...patch };
        window.clearTimeout(persistTimer);
        persistTimer = window.setTimeout(() => {
          if (windowBoundsRef.current) updateDevicePreferences({ windowBounds: windowBoundsRef.current });
        }, 220);
      };

      cleanups.push(await appWindow.onMoved(({ payload }) => {
        schedulePersist({ x: payload.x, y: payload.y });
      }));
      cleanups.push(await appWindow.onResized(({ payload }) => {
        schedulePersist({ width: payload.width, height: payload.height });
      }));
    })().catch((error) => {
      showToast(`窗口状态恢复失败：${error instanceof Error ? error.message : String(error)}`, "error");
    });

    return () => {
      disposed = true;
      window.clearTimeout(persistTimer);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [ready, showToast, updateDevicePreferences]);

  const startWindowDrag = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!isTauriRuntime() || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
      .catch((error) => showToast(`无法移动窗口：${error instanceof Error ? error.message : String(error)}`, "error"));
  }, [showToast]);

  const quitApp = useCallback(async () => {
    if (!isTauriRuntime()) {
      setCloseDialogOpen(false);
      return;
    }

    try {
      if (windowBoundsRef.current) {
        const nextState = {
          ...stateRef.current,
          devicePreferences: {
            ...stateRef.current.devicePreferences,
            windowBounds: windowBoundsRef.current,
          },
        };
        stateRef.current = nextState;
        replaceState(nextState);
      }
      await saveLauncherState(stateRef.current);

      if (sessionRef.current && stateRef.current.devicePreferences.syncOnExit) {
        window.clearTimeout(syncTimerRef.current);
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            if (activeSyncPromiseRef.current) await activeSyncPromiseRef.current;
            if (cloudStateFingerprint(stateRef.current) === lastSyncedFingerprintRef.current) break;
            await performSync(sessionRef.current);
          }
        } catch (syncError) {
          const reason = syncError instanceof Error ? syncError.message : String(syncError);
          if (!window.confirm(`退出前同步失败：${reason}\n\n本地数据已经保存，是否仍然退出？`)) {
            setCloseDialogOpen(false);
            showToast(`尚未退出：${reason}`, "error");
            return;
          }
        }
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_app");
    } catch (error) {
      setCloseDialogOpen(false);
      showToast(`无法退出应用：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [performSync, replaceState, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (closeDialogOpen) return setCloseDialogOpen(false);
        if (editorOpen) return setEditorOpen(false);
        if (settingsOpen) return setSettingsOpen(false);
        void hideWindow();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDialogOpen, editorOpen, settingsOpen, hideWindow]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let disposed = false;
    let registered = false;

    void (async () => {
      try {
        const { isRegistered, register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        const { invoke } = await import("@tauri-apps/api/core");
        const shortcut = state.devicePreferences.shortcut;
        if (await isRegistered(shortcut)) await unregister(shortcut);
        if (disposed) return;
        await register(shortcut, (event) => {
          if (event.state === "Pressed") void invoke("toggle_window");
        });
        registered = true;
      } catch (error) {
        showToast(`快捷键注册失败：${error instanceof Error ? error.message : String(error)}`, "error");
      }
    })();

    return () => {
      disposed = true;
      if (registered) {
        void import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) =>
          unregister(state.devicePreferences.shortcut).catch(() => undefined),
        );
      }
    };
  }, [ready, state.devicePreferences.shortcut, showToast]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let stop: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      setWindowVisible(await appWindow.isVisible());
      stop = await appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          setWindowVisible(true);
        } else if (stateRef.current.devicePreferences.hideOnBlur && !nativeDialogOpenRef.current) {
          void hideWindow();
        }
      });
    })();
    return () => stop?.();
  }, [hideWindow, ready, state.devicePreferences.hideOnBlur]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      cleanups.push(await listen("open-item-editor", () => {
        setEditingItem(null);
        setEditorOpen(true);
      }));
      cleanups.push(await listen("open-settings", () => setSettingsOpen(true)));
      cleanups.push(await listen("request-close-choice", () => setCloseDialogOpen(true)));
      cleanups.push(await listen("request-quit", () => void quitApp()));
      cleanups.push(await listen<boolean>("window-visibility-changed", ({ payload }) => {
        setWindowVisible(payload);
        if (payload) scheduleSync(0, true, "windowOpen");
      }));
      cleanups.push(await listen("sync-now", () => void performSync().catch((error) =>
        showToast(error instanceof Error ? error.message : "同步失败", "error"),
      )));
    })();
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [performSync, quitApp, ready, scheduleSync, showToast]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    void import("@tauri-apps/plugin-autostart").then(async ({ isEnabled }) => {
      try {
        const enabled = await isEnabled();
        if (enabled !== stateRef.current.devicePreferences.launchAtLogin) {
          updateDevicePreferences({ launchAtLogin: enabled });
        }
      } catch {
        // The UI remains usable even if the operating system blocks this check.
      }
    });
  }, [ready, updateDevicePreferences]);

  const activeCategories = useMemo(
    () => state.categories.filter((category) => !category.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    [state.categories],
  );

  const eventStats = useMemo(() => {
    const counts = new Map<string, number>();
    const lastOpened = new Map<string, string>();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let today = 0;

    for (const event of state.events) {
      counts.set(event.itemId, (counts.get(event.itemId) ?? 0) + 1);
      const previous = lastOpened.get(event.itemId);
      if (!previous || event.openedAt > previous) lastOpened.set(event.itemId, event.openedAt);
      if (new Date(event.openedAt) >= startOfToday) today += 1;
    }
    return { counts, lastOpened, today };
  }, [state.events]);

  const visibleItems = useMemo(() => {
    return state.items
      .filter((item) => !item.deletedAt && scopeMatches(item, platform))
      .filter((item) => activeCategory === "all"
        || activeCategory === "frequent" && item.frequent !== false
        || activeCategory === "favorites" && item.favorite
        || item.categoryId === activeCategory)
      .map((item) => ({ item, searchScore: launchItemSearchScore(item, query) }))
      .filter((entry) => entry.searchScore !== null)
      .sort((a, b) => query.trim()
        ? (b.searchScore ?? 0) - (a.searchScore ?? 0) || a.item.sortOrder - b.item.sortOrder
        : a.item.sortOrder - b.item.sortOrder || a.item.createdAt.localeCompare(b.item.createdAt))
      .map((entry) => entry.item);
  }, [state.items, platform, activeCategory, query]);

  const totalItems = state.items.filter((item) => !item.deletedAt && scopeMatches(item, platform)).length;
  const favoriteItems = state.items.filter((item) => !item.deletedAt && item.favorite && scopeMatches(item, platform)).length;

  const handlePointerDragMove = useCallback((draggedId: string, clientX: number, clientY: number) => {
    const targetCard = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-launcher-item-id]");
    const targetId = targetCard?.dataset.launcherItemId;
    if (!targetCard || !targetId || targetId === draggedId) {
      setDropTarget(null);
      return;
    }

    const bounds = targetCard.getBoundingClientRect();
    const placement: DropPlacement = clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    setDropTarget({ itemId: targetId, placement });

    const reorderKey = `${draggedId}:${targetId}:${placement}`;
    if (lastReorderRef.current === reorderKey) return;
    lastReorderRef.current = reorderKey;
    reorderItems(draggedId, targetId, placement);
  }, [reorderItems]);

  const runWithLaunchGuard = useCallback(async (itemId: string, operation: () => Promise<void>) => {
    if (launchLocksRef.current.has(itemId)) return;

    launchLocksRef.current.add(itemId);
    setLaunchingItemIds((current) => {
      const next = new Set(current);
      next.add(itemId);
      return next;
    });

    const startedAt = Date.now();
    try {
      await operation();
    } finally {
      const release = () => {
        launchReleaseTimersRef.current.delete(itemId);
        launchLocksRef.current.delete(itemId);
        setLaunchingItemIds((current) => {
          if (!current.has(itemId)) return current;
          const next = new Set(current);
          next.delete(itemId);
          return next;
        });
      };
      const remainingCooldown = Math.max(0, 850 - (Date.now() - startedAt));
      if (remainingCooldown > 0) {
        const timer = window.setTimeout(release, remainingCooldown);
        launchReleaseTimersRef.current.set(itemId, timer);
      } else {
        release();
      }
    }
  }, []);

  const handleLaunch = async (item: LaunchItem) => {
    await runWithLaunchGuard(item.id, async () => {
      try {
        const result = await launchItem(item, platform);
        if (result.launched.length) recordLaunch(item.id);
        if (result.errors.length) {
          showToast(
            `已打开 ${result.launched.length} 项；${result.errors.map((entry) => `${entry.name}：${entry.message}`).join("；")}`,
            "error",
          );
        }
        if (result.launched.length && stateRef.current.devicePreferences.hideAfterLaunch) {
          window.setTimeout(() => void hideWindow(), 120);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "无法打开这个入口", "error");
      }
    });
  };

  const handleActionLaunch = async (item: LaunchItem, action: LaunchAction) => {
    await runWithLaunchGuard(item.id, async () => {
      try {
        await launchAction(action, platform);
        recordLaunch(item.id);
        if (stateRef.current.devicePreferences.hideAfterLaunch) {
          window.setTimeout(() => void hideWindow(), 120);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "无法打开这个目标", "error");
      }
    });
  };

  const openCalendar = useCallback((date = localDateKey(new Date()), openDay = false) => {
    setCalendarFocusRequest((current) => ({ id: current.id + 1, date, openDay }));
    updateDevicePreferences({ homeView: "calendar" });
  }, [updateDevicePreferences]);

  const openQWeatherWebsite = async () => {
    try {
      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("launch_target", { kind: "url", target: "https://www.qweather.com" });
      } else {
        window.open("https://www.qweather.com", "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法打开和风天气网站", "error");
    }
  };

  const handleWallpaperDetect = useCallback(async (): Promise<string | null> => {
    if (!isTauriRuntime()) throw new Error("动态桌面只能在桌面应用中使用");
    setWallpaperBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const detected = await invoke<string | null>("detect_wallpaper_engine");
      if (detected) {
        updateDevicePreferences({ wallpaperEnginePath: detected });
        showToast("已找到 Wallpaper Engine");
      } else {
        showToast("没有自动找到 Wallpaper Engine，请手动选择 launcher.exe", "error");
      }
      return detected;
    } finally {
      setWallpaperBusy(false);
    }
  }, [showToast, updateDevicePreferences]);

  const handleWallpaperPickEngine = useCallback(async () => {
    if (!isTauriRuntime()) throw new Error("动态桌面只能在桌面应用中使用");
    setNativeDialogOpen(true);
    let selectedPath: string | null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "选择 Wallpaper Engine launcher.exe",
        multiple: false,
        directory: false,
        filters: [{ name: "Windows 程序", extensions: ["exe"] }],
      });
      selectedPath = typeof selected === "string" ? selected : null;
    } finally {
      setNativeDialogOpen(false);
    }
    if (selectedPath) {
      updateDevicePreferences({ wallpaperEnginePath: selectedPath });
      showToast("已保存 Wallpaper Engine 路径");
    }
  }, [showToast, updateDevicePreferences]);

  const handleWallpaperPickProject = useCallback(async () => {
    if (!isTauriRuntime()) throw new Error("动态桌面只能在桌面应用中使用");
    setNativeDialogOpen(true);
    let selectedPath: string | null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "选择 Wallpaper Engine 项目文件夹",
        multiple: false,
        directory: true,
      });
      selectedPath = typeof selected === "string" ? selected : null;
    } finally {
      setNativeDialogOpen(false);
    }
    if (selectedPath) {
      updateDevicePreferences({ wallpaperProjectPath: selectedPath });
      showToast("已保存动态桌面项目文件夹");
    }
  }, [showToast, updateDevicePreferences]);

  const handleWallpaperConfigure = useCallback(async () => {
    if (!isTauriRuntime()) throw new Error("动态桌面只能在桌面应用中使用");
    const projectPath = stateRef.current.devicePreferences.wallpaperProjectPath;
    if (!projectPath) throw new Error("请先选择 Wallpaper Engine 项目文件夹");
    setWallpaperBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("configure_wallpaper_project", { projectPath });
      showToast("天气桥接已写入 Wallpaper Engine 项目");
    } finally {
      setWallpaperBusy(false);
    }
  }, [showToast]);

  const handleWallpaperOpen = useCallback(async () => {
    if (!isTauriRuntime()) throw new Error("动态桌面只能在桌面应用中使用");
    const preferences = stateRef.current.devicePreferences;
    if (!preferences.wallpaperEnginePath) throw new Error("请先选择 Wallpaper Engine 的 launcher.exe");
    if (!preferences.wallpaperProjectPath) throw new Error("请先选择 Wallpaper Engine 项目文件夹");
    setWallpaperBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("configure_wallpaper_project", {
        projectPath: preferences.wallpaperProjectPath,
      });
      await invoke("open_wallpaper", {
        enginePath: preferences.wallpaperEnginePath,
        projectPath: preferences.wallpaperProjectPath,
      });
      updateDevicePreferences({ wallpaperEnabled: true });
      showToast("已打开 BZ Hub 动态桌面");
    } finally {
      setWallpaperBusy(false);
    }
  }, [showToast, updateDevicePreferences]);

  const handleAutostartChange = async (enabled: boolean) => {
    try {
      if (isTauriRuntime()) {
        const autostart = await import("@tauri-apps/plugin-autostart");
        if (enabled) await autostart.enable();
        else await autostart.disable();
      }
      updateDevicePreferences({ launchAtLogin: enabled });
      showToast(enabled ? "已设置为开机静默启动" : "已关闭开机启动");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法修改开机启动设置", "error");
    }
  };

  const handleKeepAwakeToggle = async () => {
    if (keepAwakeBusy) return;
    const enabled = !stateRef.current.devicePreferences.keepAwake;
    setKeepAwakeBusy(true);
    try {
      if (!isTauriRuntime()) throw new Error("保持唤醒只能在桌面应用中使用");
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_keep_awake", { enabled });
      updateDevicePreferences({ keepAwake: enabled });
      showToast(enabled ? "已阻止电脑睡眠和显示器息屏" : "已恢复系统原有电源设置");
    } catch (error) {
      showToast(`无法修改保持唤醒状态：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setKeepAwakeBusy(false);
    }
  };

  const handleTaskbarTransparencyChange = useCallback(async (enabled: boolean) => {
    if (taskbarTransparencyBusy) return;
    setTaskbarTransparencyBusy(true);
    try {
      if (!isTauriRuntime() || platform !== "windows") {
        throw new Error("任务栏透明仅支持 Windows 桌面应用");
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_taskbar_transparent", { enabled });
      const nextState = {
        ...stateRef.current,
        devicePreferences: {
          ...stateRef.current.devicePreferences,
          taskbarTransparent: enabled,
        },
      };
      commitState(nextState);
      await saveLauncherState(nextState);
      showToast(enabled ? "任务栏已切换为完全透明" : "任务栏已恢复系统默认");
    } catch (error) {
      showToast(`无法修改任务栏外观：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setTaskbarTransparencyBusy(false);
    }
  }, [commitState, platform, showToast, taskbarTransparencyBusy]);

  const handleAiControlChange = useCallback(async (enabled: boolean) => {
    if (aiControlBusy) return;
    setAiControlBusy(true);
    try {
      if (!isTauriRuntime()) throw new Error("AI 控制只能在桌面应用中使用");
      const preferences = stateRef.current.devicePreferences;
      const token = preferences.aiControlToken || createAiControlToken();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("configure_ai_control", { enabled, token });
      const nextState = {
        ...stateRef.current,
        devicePreferences: {
          ...stateRef.current.devicePreferences,
          aiControlEnabled: enabled,
          aiControlToken: token,
        },
      };
      commitState(nextState);
      await saveLauncherState(nextState);
      showToast(enabled ? "已允许本机 AI 控制 BZ Hub" : "已关闭 AI 控制");
    } catch (error) {
      showToast(`无法修改 AI 控制状态：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setAiControlBusy(false);
    }
  }, [aiControlBusy, commitState, showToast]);

  const handleAiControlEnvelope = useCallback(async (contents: string): Promise<AiControlResponse> => {
    let requestId = "unknown";
    try {
      const request = parseAiControlEnvelope(contents);
      requestId = request.requestId;
      const preferences = stateRef.current.devicePreferences;
      if (!preferences.aiControlEnabled) throw new Error("BZ Hub 的 AI 控制尚未开启");
      if (!preferences.aiControlToken || request.token !== preferences.aiControlToken) {
        throw new Error("BZ Hub 拒绝了未经授权的 AI 请求");
      }
      const persistAiState = async (nextState: LauncherState) => {
        commitState(nextState);
        await saveLauncherState(nextState);
      };

      const params = request.params;
      if (request.action === "get_status") {
        const current = stateRef.current;
        const today = localDateKey(new Date());
        const activeItems = current.items.filter((item) => !item.deletedAt && scopeMatches(item, platform));
        const activeCalendarEntries = current.calendarEntries.filter((entry) => !entry.deletedAt);
        const nextImportant = activeCalendarEntries
          .filter((entry) => !entry.completed && entry.importance === "important" && entry.date >= today)
          .sort(compareCalendarEntries)[0];
        return aiControlSuccess(requestId, {
          application: "BZ Hub",
          platform,
          today,
          entryCount: activeItems.length,
          calendarEntryCount: activeCalendarEntries.length,
          nextImportant: nextImportant ? calendarEntryForAi(nextImportant, current.items) : null,
        });
      }

      if (request.action === "search_entries") {
        const queryValue = requiredString(params, "query", 200);
        const limit = optionalInteger(params, "limit", 1, 25) ?? 10;
        const current = stateRef.current;
        const categoryNames = new Map(current.categories.map((category) => [category.id, category.name]));
        const matches = current.items
          .filter((item) => !item.deletedAt && scopeMatches(item, platform))
          .map((item) => ({ item, score: launchItemSearchScore(item, queryValue) }))
          .filter((entry): entry is { item: LaunchItem; score: number } => entry.score !== null)
          .sort((left, right) => right.score - left.score || left.item.sortOrder - right.item.sortOrder)
          .slice(0, limit)
          .map(({ item, score }) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            category: categoryNames.get(item.categoryId) ?? "未分类",
            kind: item.kind,
            favorite: item.favorite,
            frequent: item.frequent,
            score,
            actions: launchActionsFor(item)
              .filter((action) => canLaunchAction(action, platform))
              .map((action) => ({
                id: action.id,
                name: action.name,
                icon: action.icon || item.icon,
                kind: action.kind,
                primary: action.id === `primary-${item.id}`,
                includeInBatch: action.includeInBatch !== false,
              })),
          }));
        return aiControlSuccess(requestId, { query: queryValue, matches });
      }

      if (request.action === "open_entry") {
        const entryId = requiredString(params, "entryId", 200);
        const actionId = optionalString(params, "actionId", 200);
        const item = stateRef.current.items.find((candidate) =>
          candidate.id === entryId && !candidate.deletedAt && scopeMatches(candidate, platform),
        );
        if (!item) throw new Error("没有找到当前设备可用的入口");

        let launched: string[];
        let errors: Array<{ name: string; message: string }> = [];
        if (actionId) {
          const action = launchActionsFor(item).find((candidate) => candidate.id === actionId);
          if (!action || !canLaunchAction(action, platform)) throw new Error("没有找到当前设备可用的子目标");
          await launchAction(action, platform);
          launched = [action.name];
        } else {
          const result = await launchItem(item, platform);
          launched = result.launched;
          errors = result.errors;
        }

        if (launched.length) {
          const current = stateRef.current;
          await persistAiState({
            ...current,
            events: [...current.events, {
              id: createId(),
              itemId: item.id,
              deviceId: current.deviceId,
              openedAt: new Date().toISOString(),
            }],
          });
          showToast(`AI 已打开：${launched.join("、")}`);
        }
        return aiControlSuccess(requestId, {
          entryId: item.id,
          entryName: item.name,
          launched,
          errors,
        });
      }

      if (request.action === "list_calendar_entries") {
        const today = localDateKey(new Date());
        const from = optionalString(params, "from", 32) ?? today;
        if (!isLocalDateKey(from)) throw new Error("from 必须是 YYYY-MM-DD 格式的有效日期");
        const to = optionalString(params, "to", 32) ?? offsetDateKey(from, 365);
        if (!isLocalDateKey(to)) throw new Error("to 必须是 YYYY-MM-DD 格式的有效日期");
        if (to < from) throw new Error("to 不能早于 from");
        const completed = optionalBoolean(params, "completed");
        const importance = optionalString(params, "importance", 20);
        if (importance && importance !== "normal" && importance !== "important") {
          throw new Error("importance 只能是 normal 或 important");
        }
        const limit = optionalInteger(params, "limit", 1, 200) ?? 100;
        const current = stateRef.current;
        const entries = current.calendarEntries
          .filter((entry) => !entry.deletedAt && entry.date >= from && entry.date <= to)
          .filter((entry) => completed === undefined || entry.completed === completed)
          .filter((entry) => !importance || entry.importance === importance)
          .sort(compareCalendarEntries)
          .slice(0, limit)
          .map((entry) => calendarEntryForAi(entry, current.items));
        return aiControlSuccess(requestId, { from, to, entries });
      }

      if (request.action === "create_calendar_entry") {
        const title = requiredString(params, "title", 120);
        const date = requiredString(params, "date", 32);
        if (!isLocalDateKey(date)) throw new Error("date 必须是 YYYY-MM-DD 格式的有效日期");
        const time = optionalString(params, "time", 32);
        if (time && !CALENDAR_TIME_PATTERN.test(time)) throw new Error("time 必须是 HH:mm 格式");
        const note = optionalString(params, "note", 2_000);
        const importanceValue = optionalString(params, "importance", 20) ?? "normal";
        if (importanceValue !== "normal" && importanceValue !== "important") {
          throw new Error("importance 只能是 normal 或 important");
        }
        const linkedItemId = optionalString(params, "linkedItemId", 200);
        const current = stateRef.current;
        if (linkedItemId && !current.items.some((item) => item.id === linkedItemId && !item.deletedAt)) {
          throw new Error("linkedItemId 对应的入口不存在");
        }
        const timestamp = new Date().toISOString();
        const entry: CalendarEntry = {
          id: createId(),
          title,
          date,
          time,
          note,
          importance: importanceValue,
          completed: false,
          linkedItemId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await persistAiState({ ...current, calendarEntries: [...current.calendarEntries, entry] });
        showToast(`AI 已添加日程：${entry.title}`);
        return aiControlSuccess(requestId, calendarEntryForAi(entry, current.items));
      }

      if (request.action === "update_calendar_entry") {
        const entryId = requiredString(params, "entryId", 200);
        const current = stateRef.current;
        const existing = current.calendarEntries.find((entry) => entry.id === entryId && !entry.deletedAt);
        if (!existing) throw new Error("没有找到要修改的日历事项");
        const patch: Partial<CalendarEntry> = {};
        let changed = false;

        if (hasOwn(params, "title")) {
          patch.title = requiredString(params, "title", 120);
          changed = true;
        }
        if (hasOwn(params, "date")) {
          const date = requiredString(params, "date", 32);
          if (!isLocalDateKey(date)) throw new Error("date 必须是 YYYY-MM-DD 格式的有效日期");
          patch.date = date;
          changed = true;
        }
        if (hasOwn(params, "time")) {
          const time = optionalString(params, "time", 32);
          if (time && !CALENDAR_TIME_PATTERN.test(time)) throw new Error("time 必须是 HH:mm 格式");
          patch.time = time;
          changed = true;
        }
        if (hasOwn(params, "note")) {
          patch.note = optionalString(params, "note", 2_000);
          changed = true;
        }
        if (hasOwn(params, "importance")) {
          const importance = requiredString(params, "importance", 20);
          if (importance !== "normal" && importance !== "important") {
            throw new Error("importance 只能是 normal 或 important");
          }
          patch.importance = importance;
          changed = true;
        }
        if (hasOwn(params, "linkedItemId")) {
          const linkedItemId = optionalString(params, "linkedItemId", 200);
          if (linkedItemId && !current.items.some((item) => item.id === linkedItemId && !item.deletedAt)) {
            throw new Error("linkedItemId 对应的入口不存在");
          }
          patch.linkedItemId = linkedItemId;
          changed = true;
        }
        if (!changed) throw new Error("没有提供要修改的字段");

        const updated: CalendarEntry = { ...existing, ...patch, updatedAt: new Date().toISOString() };
        await persistAiState({
          ...current,
          calendarEntries: current.calendarEntries.map((entry) => entry.id === entryId ? updated : entry),
        });
        showToast(`AI 已更新日程：${updated.title}`);
        return aiControlSuccess(requestId, calendarEntryForAi(updated, current.items));
      }

      if (request.action === "set_calendar_entry_completed") {
        const entryId = requiredString(params, "entryId", 200);
        const completed = optionalBoolean(params, "completed");
        if (completed === undefined) throw new Error("缺少 completed");
        const current = stateRef.current;
        const existing = current.calendarEntries.find((entry) => entry.id === entryId && !entry.deletedAt);
        if (!existing) throw new Error("没有找到要更新的日历事项");
        const updated = { ...existing, completed, updatedAt: new Date().toISOString() };
        await persistAiState({
          ...current,
          calendarEntries: current.calendarEntries.map((entry) => entry.id === entryId ? updated : entry),
        });
        showToast(completed ? `AI 已完成日程：${updated.title}` : `AI 已恢复日程：${updated.title}`);
        return aiControlSuccess(requestId, calendarEntryForAi(updated, current.items));
      }

      if (request.action === "delete_calendar_entry") {
        const entryId = requiredString(params, "entryId", 200);
        const current = stateRef.current;
        const existing = current.calendarEntries.find((entry) => entry.id === entryId && !entry.deletedAt);
        if (!existing) throw new Error("没有找到要删除的日历事项");
        const deletedAt = new Date().toISOString();
        await persistAiState({
          ...current,
          calendarEntries: current.calendarEntries.map((entry) => entry.id === entryId
            ? { ...entry, deletedAt, updatedAt: deletedAt }
            : entry),
        });
        showToast(`AI 已删除日程：${existing.title}`);
        return aiControlSuccess(requestId, { entryId, title: existing.title, deleted: true });
      }

      throw new Error(`不支持的 AI 操作：${request.action}`);
    } catch (error) {
      return aiControlFailure(requestId, error);
    }
  }, [commitState, platform, showToast]);

  const drainAiControlRequests = useCallback(async () => {
    if (aiControlDrainRunningRef.current) {
      aiControlDrainQueuedRef.current = true;
      return;
    }
    aiControlDrainRunningRef.current = true;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let keepDraining = true;
      while (keepDraining) {
        aiControlDrainQueuedRef.current = false;
        const requests = await invoke<QueuedAiControlRequest[]>("take_ai_control_requests");
        for (const request of requests) {
          const response = await handleAiControlEnvelope(request.contents);
          await invoke("complete_ai_control_request", {
            requestPath: request.requestPath,
            contents: JSON.stringify(response),
          });
        }
        keepDraining = requests.length > 0 || aiControlDrainQueuedRef.current;
      }
    } catch (error) {
      showToast(`AI 控制桥接失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      aiControlDrainRunningRef.current = false;
      if (aiControlDrainQueuedRef.current) void drainAiControlRequests();
    }
  }, [handleAiControlEnvelope, showToast]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    const preferences = stateRef.current.devicePreferences;
    const token = preferences.aiControlToken || createAiControlToken();
    if (!preferences.aiControlToken) {
      commitState({
        ...stateRef.current,
        devicePreferences: { ...stateRef.current.devicePreferences, aiControlToken: token },
      });
    }
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("configure_ai_control", {
        enabled: preferences.aiControlEnabled,
        token,
      }))
      .catch((error) => {
        if (preferences.aiControlEnabled) {
          commitState({
            ...stateRef.current,
            devicePreferences: { ...stateRef.current.devicePreferences, aiControlEnabled: false },
          });
          showToast(`AI 控制初始化失败，已自动关闭：${error instanceof Error ? error.message : String(error)}`, "error");
        }
      });
  }, [commitState, ready, showToast]);

  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      cleanup = await listen("ai-control-request-ready", () => void drainAiControlRequests());
      if (!disposed) await drainAiControlRequests();
    })().catch((error) => {
      if (!disposed) showToast(`无法启动 AI 控制桥接：${error instanceof Error ? error.message : String(error)}`, "error");
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [drainAiControlRequests, ready, showToast]);

  const handleExportData = async (): Promise<string | null> => {
    if (!isTauriRuntime()) throw new Error("数据导出只能在桌面应用中使用");
    setNativeDialogOpen(true);
    let selectedPath: string | null;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      selectedPath = await save({
        title: "导出 BZ Hub 数据",
        defaultPath: `BZ-Hub-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "BZ Hub JSON", extensions: ["json"] }],
      });
    } finally {
      setNativeDialogOpen(false);
    }
    if (!selectedPath) return null;

    const contents = JSON.stringify(createLauncherExport(stateRef.current), null, 2);
    const { invoke } = await import("@tauri-apps/api/core");
    const exportPath = selectedPath.toLocaleLowerCase().endsWith(".json") ? selectedPath : `${selectedPath}.json`;
    await invoke("write_text_file", { path: exportPath, contents });
    return `已导出 ${stateRef.current.items.filter((item) => !item.deletedAt).length} 个入口`;
  };

  const handleImportData = async (mode: ImportMode): Promise<string | null> => {
    if (!isTauriRuntime()) throw new Error("数据导入只能在桌面应用中使用");
    setNativeDialogOpen(true);
    let selectedPath: string | null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      selectedPath = await open({
        title: mode === "merge" ? "选择要合并的 BZ Hub 数据" : "选择要替换当前数据的 BZ Hub 文件",
        multiple: false,
        directory: false,
        filters: [{ name: "BZ Hub JSON", extensions: ["json"] }],
      });
    } finally {
      setNativeDialogOpen(false);
    }
    if (typeof selectedPath !== "string") return null;

    const { invoke } = await import("@tauri-apps/api/core");
    const contents = await invoke<string>("read_text_file", { path: selectedPath });
    const imported = parseLauncherExport(contents);
    const nextState = applyLauncherImport(stateRef.current, imported, mode);
    stateRef.current = nextState;
    replaceState(nextState);
    await saveLauncherState(nextState);
    return mode === "merge"
      ? `合并完成，当前共有 ${nextState.items.filter((item) => !item.deletedAt).length} 个入口`
      : `替换完成，已载入 ${nextState.items.filter((item) => !item.deletedAt).length} 个入口`;
  };

  const handleVerifyEmailLogin = async (email: string, credential: string) => {
    const verified = await verifyEmailLogin(email, credential);
    sessionRef.current = verified;
    setSession(verified);
    await performSync(verified);
  };

  const handleSignOut = async () => {
    try {
      await signOutCloud();
      setSession(null);
      setState((current) => ({
        ...current,
        syncMeta: { ...current.syncMeta, enabled: false, lastError: undefined },
      }));
      showToast("已退出同步账户，本地数据仍然保留");
    } catch (error) {
      showToast(`退出同步账户失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  const dateLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  if (!ready) {
    return (
      <div className="app-loading">
        <span className="brand-mark"><Command size={20} /></span>
        <LoaderCircle className="spin" size={22} />
        <p>正在整理你的入口…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="titlebar" onMouseDown={startWindowDrag}>
        <div className="brand">
          <span className="brand-mark"><Command size={17} /></span>
          <span>
            <strong>BZ Hub</strong>
            <small>{platformLabel(platform)}</small>
          </span>
        </div>

        <div className="titlebar__spacer" />

        <span className={`cloud-indicator ${session ? "is-online" : ""}`} title={session ? "云同步已连接" : "本地模式"}>
          {session ? <Cloud size={14} /> : <CloudOff size={14} />}
          {syncing ? "同步中" : session ? "已连接" : "本地"}
        </span>
        <button type="button" className="titlebar-button" onClick={() => { setEditingItem(null); setEditorOpen(true); }} aria-label="添加入口">
          <Plus size={17} />
        </button>
        {platform === "windows" && isTauriRuntime() && (
          <RecycleBinButton onError={(message) => showToast(message, "error")} />
        )}
        <button type="button" className="titlebar-button" onClick={() => setSettingsOpen(true)} aria-label="设置">
          <Settings size={16} />
        </button>
        <button type="button" className="titlebar-button" onClick={() => void hideWindow()} aria-label="收起">
          <ChevronDown size={18} />
        </button>
        <button type="button" className="titlebar-button titlebar-button--close" onClick={() => setCloseDialogOpen(true)} aria-label="关闭">
          <X size={17} />
        </button>
      </header>

      <main className={`dashboard dashboard--${state.devicePreferences.homeView}`}>
        <section className="hero">
          <div className="hero__time">
            <span className="eyebrow">{greetingFor(now.getHours())}</span>
            <div className="hero__clock-row">
              <h1>{timeLabel}</h1>
              <div className="calendar-shell">
                <button
                  type="button"
                  className="hero__date-button"
                  aria-describedby="date-calendar"
                  title="查看本月和下月日历"
                  onClick={() => openCalendar(localDateKey(now))}
                >
                  <CalendarDays size={13} />
                  <strong className="hero__date">{dateLabel}</strong>
                </button>
                <NextCalendarHighlight
                  entries={state.calendarEntries}
                  today={now}
                  onOpen={(date) => openCalendar(date, true)}
                />
              </div>
              <CalendarPopover today={now} />
            </div>
          </div>

          <div className="weather-card-shell">
            <button
              type="button"
              className="weather-card"
              onClick={() => {
                if (!state.devicePreferences.qweatherApiHost || !state.devicePreferences.qweatherApiKey) {
                  setSettingsOpen(true);
                } else {
                  void loadWeather(true);
                }
              }}
              title={state.devicePreferences.qweatherApiKey ? "刷新天气" : "配置和风天气"}
              aria-describedby={weather ? "weather-details" : undefined}
            >
              <span className="weather-card__icon">{weatherLoading ? <LoaderCircle size={24} className="spin" /> : weather?.icon ?? "◌"}</span>
              <span className="weather-card__content">
                <strong>{weather ? `${weather.temperature}°` : "--°"}</strong>
                <small>{weather?.city ?? state.sharedPreferences.weatherCity} · {weather?.label ?? (weatherError || "正在获取")}</small>
              </span>
              <RefreshCw size={13} className={weatherLoading ? "spin" : ""} />
            </button>
            {weather && (
              <div id="weather-details" className="weather-details" role="tooltip">
                <header>
                  <span>
                    <small>实时天气</small>
                    <strong>{weather.city}</strong>
                  </span>
                  <b>{weather.icon} {weather.label}</b>
                </header>
                <div className="weather-details__grid">
                  <span><Thermometer size={14} /><small>体感</small><strong>{weather.apparentTemperature}°</strong></span>
                  <span><Droplets size={14} /><small>湿度</small><strong>{weather.humidity ? `${weather.humidity}%` : "—"}</strong></span>
                  <span><Wind size={14} /><small>风向风力</small><strong>{[weather.windDirection, weather.windScale && `${weather.windScale}级`].filter(Boolean).join(" ") || "—"}</strong></span>
                  <span><Wind size={14} /><small>风速</small><strong>{weather.windSpeed ? `${weather.windSpeed} km/h` : "—"}</strong></span>
                  <span><CloudRain size={14} /><small>降水</small><strong>{weather.precipitation ? `${weather.precipitation} mm` : "—"}</strong></span>
                  <span><Gauge size={14} /><small>气压</small><strong>{weather.pressure ? `${weather.pressure} hPa` : "—"}</strong></span>
                  <span><Eye size={14} /><small>能见度</small><strong>{weather.visibility ? `${weather.visibility} km` : "—"}</strong></span>
                  <span><Cloud size={14} /><small>云量</small><strong>{weather.cloudCover ? `${weather.cloudCover}%` : "—"}</strong></span>
                  <span><Thermometer size={14} /><small>露点</small><strong>{weather.dewPoint ? `${weather.dewPoint}°` : "—"}</strong></span>
                </div>
                <footer><Clock3 size={12} /> 观测于 {formatWeatherObservation(weather.observedAt)}</footer>
              </div>
            )}
            <button type="button" className="weather-attribution" onClick={() => void openQWeatherWebsite()}>
              天气服务由和风天气驱动
            </button>
          </div>
        </section>

        <section className="quick-stats" aria-label="使用概览">
          <div>
            <span><Grid2X2 size={15} /></span>
            <p><strong>{totalItems}</strong><small>当前入口</small></p>
          </div>
          <div>
            <span><Star size={15} /></span>
            <p><strong>{favoriteItems}</strong><small>首页收藏</small></p>
          </div>
          <div>
            <span><Sparkles size={15} /></span>
            <p><strong>{eventStats.today}</strong><small>今日打开</small></p>
          </div>
          <button
            type="button"
            className={`quick-stats__awake ${state.devicePreferences.keepAwake ? "is-active" : ""}`}
            onClick={() => void handleKeepAwakeToggle()}
            disabled={keepAwakeBusy}
            aria-pressed={state.devicePreferences.keepAwake}
            title={state.devicePreferences.keepAwake ? "点击恢复系统电源设置" : "点击阻止电脑睡眠和显示器息屏"}
          >
            <span>{keepAwakeBusy ? <LoaderCircle size={15} className="spin" /> : <Sun size={15} />}</span>
            <p>
              <strong>保持唤醒</strong>
              <small>{state.devicePreferences.keepAwake ? "已阻止睡眠与息屏" : "遵循系统电源设置"}</small>
            </p>
            <i className="quick-stats__switch" aria-hidden="true"><b /></i>
          </button>
        </section>

        <nav className="view-switcher" aria-label="切换主页">
          <button
            type="button"
            className={state.devicePreferences.homeView === "launcher" ? "is-active" : ""}
            onClick={() => updateDevicePreferences({ homeView: "launcher" })}
          >
            <LayoutGrid size={14} /> 入口
          </button>
          <button
            type="button"
            className={state.devicePreferences.homeView === "calendar" ? "is-active" : ""}
            onClick={() => openCalendar(localDateKey(now))}
          >
            <CalendarDays size={14} /> 日历
          </button>
          <button
            type="button"
            className={state.devicePreferences.homeView === "dashboard" ? "is-active" : ""}
            onClick={() => updateDevicePreferences({ homeView: "dashboard" })}
          >
            <BarChart3 size={14} /> 数据看板
          </button>
        </nav>

        {state.devicePreferences.homeView === "launcher" ? (
          <div className="launcher-view">

        <section className="launcher-toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、别名或拼音…"
              aria-label="搜索入口"
            />
            <kbd>{platform === "macos" ? "⌘" : "Ctrl"} K</kbd>
          </label>

          <nav className="category-tabs" aria-label="筛选分类">
            <button type="button" className={activeCategory === "frequent" ? "is-active" : ""} onClick={() => setActiveCategory("frequent")}>
              <Pin size={13} /> 常用
            </button>
            <button type="button" className={activeCategory === "all" ? "is-active" : ""} onClick={() => setActiveCategory("all")}>全部</button>
            <button type="button" className={activeCategory === "favorites" ? "is-active" : ""} onClick={() => setActiveCategory("favorites")}>
              <Star size={13} /> 收藏
            </button>
            {activeCategories.map((category) => (
              <button
                type="button"
                key={category.id}
                className={activeCategory === category.id ? "is-active" : ""}
                onClick={() => setActiveCategory(category.id)}
              >
                <i style={{ background: category.color }} /> {category.name}
              </button>
            ))}
          </nav>
        </section>

        <section className="launcher-section">
          <header>
            <div>
              <h2>{activeCategory === "frequent" ? "常用入口" : activeCategory === "all" ? "你的入口" : activeCategory === "favorites" ? "收藏入口" : activeCategories.find((entry) => entry.id === activeCategory)?.name}</h2>
              <span>{visibleItems.length} 项</span>
            </div>
            <button type="button" className="text-button" onClick={() => { setEditingItem(null); setEditorOpen(true); }}>
              <Plus size={14} /> 新建入口
            </button>
          </header>

          {visibleItems.length ? (
            <div className="launcher-grid">
              {visibleItems.map((item) => (
                <LauncherCard
                  key={item.id}
                  item={item}
                  category={activeCategories.find((category) => category.id === item.categoryId)}
                  platform={platform}
                  usageCount={eventStats.counts.get(item.id) ?? 0}
                  lastOpenedAt={eventStats.lastOpened.get(item.id)}
                  launching={launchingItemIds.has(item.id)}
                  onLaunch={() => void handleLaunch(item)}
                  onLaunchAction={(action) => void handleActionLaunch(item, action)}
                  onEdit={() => { setEditingItem(item); setEditorOpen(true); }}
                  dragging={draggedItemId === item.id}
                  dropPlacement={dropTarget?.itemId === item.id && draggedItemId !== item.id ? dropTarget.placement : undefined}
                  onPointerDragStart={() => {
                    lastReorderRef.current = "";
                    setDraggedItemId(item.id);
                    setDropTarget(null);
                  }}
                  onPointerDragMove={(clientX, clientY) => handlePointerDragMove(item.id, clientX, clientY)}
                  onPointerDragEnd={() => {
                    lastReorderRef.current = "";
                    setDraggedItemId(null);
                    setDropTarget(null);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span><Search size={22} /></span>
              <h3>{query ? "没有找到匹配入口" : "这里还没有入口"}</h3>
              <p>{query ? "试试其他关键词或分类。" : "添加网页、应用或项目文件夹，建立你的工作起点。"}</p>
              {!query && (
                <button type="button" className="button button--primary" onClick={() => { setEditingItem(null); setEditorOpen(true); }}>
                  <Plus size={15} /> 添加入口
                </button>
              )}
            </div>
          )}
        </section>
          </div>
        ) : state.devicePreferences.homeView === "calendar" ? (
          <CalendarPage
            today={now}
            entries={state.calendarEntries}
            launchItems={state.items.filter((item) => !item.deletedAt)}
            focusRequest={calendarFocusRequest}
            onSaveEntry={upsertCalendarEntry}
            onDeleteEntry={removeCalendarEntry}
            onToggleEntry={toggleCalendarEntry}
            onLaunchItem={(item) => void handleLaunch(item)}
            onNotify={(message, type = "success") => showToast(message, type)}
          />
        ) : (
          <section className="data-dashboard-placeholder">
            <header>
              <span><BarChart3 size={23} /></span>
              <div>
                <span className="eyebrow">DATA DASHBOARD</span>
                <h2>数据看板</h2>
                <p>页面入口已经准备好，后续再根据实际需求加入有价值的数据。</p>
              </div>
            </header>
            <div className="data-dashboard-placeholder__grid">
              <article><span>启动趋势</span><strong>待定义</strong><i /></article>
              <article><span>设备分布</span><strong>待定义</strong><i /></article>
              <article><span>常用项目</span><strong>待定义</strong><i /></article>
            </div>
          </section>
        )}
      </main>

      {editorOpen && (
        <ItemEditor
          item={editingItem}
          categories={state.categories}
          platform={platform}
          onClose={() => setEditorOpen(false)}
          onSave={(item) => {
            upsertItem(item);
            setEditorOpen(false);
            showToast(editingItem ? "入口已更新" : "入口已添加");
          }}
          onDelete={(itemId) => {
            removeItem(itemId);
            setEditorOpen(false);
            showToast("入口已删除");
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          categories={state.categories}
          sharedPreferences={state.sharedPreferences}
          devicePreferences={state.devicePreferences}
          cloudConfigured={isCloudConfigured}
          accountEmail={session?.user.email}
          syncing={syncing}
          aiControlBusy={aiControlBusy}
          taskbarTransparencyAvailable={platform === "windows"}
          taskbarTransparencyBusy={taskbarTransparencyBusy}
          wallpaperBusy={wallpaperBusy}
          wallpaperBridgeInfo={wallpaperBridgeInfo}
          lastSyncedAt={state.syncMeta.lastSyncedAt}
          syncError={state.syncMeta.lastError}
          onClose={() => setSettingsOpen(false)}
          onSharedPreferencesChange={updateSharedPreferences}
          onDevicePreferencesChange={updateDevicePreferences}
          onAutostartChange={handleAutostartChange}
          onAiControlChange={handleAiControlChange}
          onTaskbarTransparencyChange={handleTaskbarTransparencyChange}
          onWallpaperDetect={handleWallpaperDetect}
          onWallpaperPickEngine={handleWallpaperPickEngine}
          onWallpaperPickProject={handleWallpaperPickProject}
          onWallpaperConfigure={handleWallpaperConfigure}
          onWallpaperOpen={handleWallpaperOpen}
          onCategorySave={upsertCategory}
          onCategoryDelete={removeCategory}
          onExportData={handleExportData}
          onImportData={handleImportData}
          onSendOtp={sendEmailOtp}
          onVerifyEmailLogin={handleVerifyEmailLogin}
          onSignOut={handleSignOut}
          onSync={async () => {
            try {
              await performSync();
              showToast("云端数据已同步");
            } catch (error) {
              showToast(error instanceof Error ? error.message : "同步失败", "error");
            }
          }}
        />
      )}

      {closeDialogOpen && (
        <CloseDialog
          onCancel={() => setCloseDialogOpen(false)}
          onHide={() => {
            setCloseDialogOpen(false);
            void hideWindow();
          }}
          onQuit={() => void quitApp()}
        />
      )}

      {toast && <Toast key={toast.id} toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
