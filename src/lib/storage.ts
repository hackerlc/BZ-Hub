import { createDefaultState } from "../data/defaultState";
import type { LauncherState } from "../types";
import { isTauriRuntime } from "./platform";
import { normalizeLaunchItem } from "./targets";
import { normalizeCalendarEntry } from "./calendarEntries";

const STORAGE_KEY = "bz-hub-state-v1";
const STORE_FILE = "bz-hub.json";
const LEGACY_MIGRATION_KEY = "bz-hub-localstorage-migrated-v1";
const DEFAULT_SAMPLE_IDS = new Set(["sample-supabase", "sample-github", "sample-weather"]);

export function normalizeLauncherState(value: unknown): LauncherState {
  const fallback = createDefaultState();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<LauncherState>;
  if (candidate.version !== 1) return fallback;

  return {
    ...fallback,
    ...candidate,
    categories: Array.isArray(candidate.categories) ? candidate.categories : fallback.categories,
    items: Array.isArray(candidate.items)
      ? candidate.items.map(normalizeLaunchItem)
      : fallback.items,
    events: Array.isArray(candidate.events) ? candidate.events : fallback.events,
    calendarEntries: Array.isArray(candidate.calendarEntries)
      ? candidate.calendarEntries.map(normalizeCalendarEntry).filter((entry) => entry !== null)
      : fallback.calendarEntries,
    sharedPreferences: {
      ...fallback.sharedPreferences,
      ...candidate.sharedPreferences,
    },
    devicePreferences: {
      ...fallback.devicePreferences,
      ...candidate.devicePreferences,
      homeView: candidate.devicePreferences?.homeView === "calendar"
        || candidate.devicePreferences?.homeView === "dashboard"
        ? candidate.devicePreferences.homeView
        : "launcher",
    },
    syncMeta: {
      ...fallback.syncMeta,
      ...candidate.syncMeta,
    },
  };
}

function readLegacyState(): LauncherState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LauncherState>;
    if (!parsed || parsed.version !== 1) return null;
    return normalizeLauncherState(parsed);
  } catch (error) {
    console.warn("读取旧版入口数据失败，将继续使用当前存储。", error);
    return null;
  }
}

function isDefaultSampleState(state: LauncherState): boolean {
  const activeItems = state.items.filter((item) => !item.deletedAt);
  return activeItems.length === DEFAULT_SAMPLE_IDS.size
    && activeItems.every((item) => DEFAULT_SAMPLE_IDS.has(item.id));
}

function mergeLegacyDevicePreferences(
  legacy: LauncherState,
  stored: LauncherState | null,
): LauncherState {
  if (!stored) return legacy;
  return {
    ...legacy,
    devicePreferences: {
      ...stored.devicePreferences,
      ...legacy.devicePreferences,
      qweatherApiHost: legacy.devicePreferences.qweatherApiHost || stored.devicePreferences.qweatherApiHost,
      qweatherApiKey: legacy.devicePreferences.qweatherApiKey || stored.devicePreferences.qweatherApiKey,
    },
  };
}

export async function loadLauncherState(): Promise<LauncherState> {
  try {
    if (isTauriRuntime()) {
      const { LazyStore } = await import("@tauri-apps/plugin-store");
      const store = new LazyStore(STORE_FILE);
      const storedValue = await store.get<LauncherState>(STORAGE_KEY);
      const storedState = storedValue ? normalizeLauncherState(storedValue) : null;
      const migrationFinished = await store.get<boolean>(LEGACY_MIGRATION_KEY);

      if (!migrationFinished) {
        const legacyState = readLegacyState();
        if (legacyState) {
          const shouldMigrate = !storedState
            || isDefaultSampleState(storedState) && !isDefaultSampleState(legacyState);
          if (shouldMigrate) {
            const migrated = mergeLegacyDevicePreferences(legacyState, storedState);
            await store.set(STORAGE_KEY, migrated);
            await store.set(LEGACY_MIGRATION_KEY, true);
            await store.save();
            return migrated;
          }
          await store.set(LEGACY_MIGRATION_KEY, true);
          await store.save();
        }
      }

      return storedState ?? createDefaultState();
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeLauncherState(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.error("读取本地配置失败，将使用默认配置。", error);
    return createDefaultState();
  }
}

export async function saveLauncherState(state: LauncherState): Promise<void> {
  if (isTauriRuntime()) {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    const store = new LazyStore(STORE_FILE);
    await store.set(STORAGE_KEY, state);
    await store.save();
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
