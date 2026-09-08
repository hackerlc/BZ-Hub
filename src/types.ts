export type DesktopPlatform = "windows" | "macos" | "linux" | "web";

export type LaunchKind = "url" | "application" | "project" | "folder" | "file";

export type HomeView = "launcher" | "calendar" | "dashboard";

export type PlatformScope = "all" | "windows" | "macos";

export interface LaunchTarget {
  value: string;
  arguments?: string;
}

export interface LaunchAction {
  id: string;
  name: string;
  icon?: string;
  kind: LaunchKind;
  scope: PlatformScope;
  url?: string;
  targets: Partial<Record<"windows" | "macos", LaunchTarget>>;
  includeInBatch?: boolean;
  delayMs?: number;
}

export interface LaunchItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  kind: LaunchKind;
  scope: PlatformScope;
  url?: string;
  targets: Partial<Record<"windows" | "macos", LaunchTarget>>;
  linkedTargets?: LaunchAction[];
  aliases?: string[];
  categoryId: string;
  frequent: boolean;
  favorite: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface LaunchEvent {
  id: string;
  itemId: string;
  deviceId: string;
  openedAt: string;
}

export type CalendarEntryImportance = "normal" | "important";

export interface CalendarEntry {
  id: string;
  title: string;
  date: string;
  time?: string;
  note?: string;
  importance: CalendarEntryImportance;
  completed: boolean;
  linkedItemId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface SharedPreferences {
  weatherCity: string;
  updatedAt: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DevicePreferences {
  launchAtLogin: boolean;
  keepAwake: boolean;
  taskbarTransparent: boolean;
  wallpaperEnabled: boolean;
  wallpaperEnginePath: string;
  wallpaperProjectPath: string;
  wallpaperSimulationEnabled: boolean;
  wallpaperSimulationTime: string;
  wallpaperSimulationWeather: string;
  wallpaperSimulationWindSpeed: number;
  aiControlEnabled: boolean;
  aiControlToken: string;
  shortcut: string;
  hideOnBlur: boolean;
  hideAfterLaunch: boolean;
  syncOnDataChange: boolean;
  syncOnNetworkReconnect: boolean;
  syncOnWindowOpen: boolean;
  syncOnExit: boolean;
  qweatherApiHost: string;
  qweatherApiKey: string;
  homeView: HomeView;
  windowBounds?: WindowBounds;
}

export interface SyncMeta {
  enabled: boolean;
  lastSyncedAt?: string;
  lastError?: string;
  cloudRevision: number;
}

export interface LauncherState {
  version: 1;
  deviceId: string;
  categories: Category[];
  items: LaunchItem[];
  events: LaunchEvent[];
  calendarEntries: CalendarEntry[];
  sharedPreferences: SharedPreferences;
  devicePreferences: DevicePreferences;
  syncMeta: SyncMeta;
}

export interface CloudLauncherState {
  version: 1;
  categories: Category[];
  items: LaunchItem[];
  events: LaunchEvent[];
  calendarEntries: CalendarEntry[];
  sharedPreferences: SharedPreferences;
}

export interface WeatherSnapshot {
  city: string;
  temperature: number;
  apparentTemperature: number;
  weatherCode: number;
  label: string;
  icon: string;
  observedAt?: string;
  windDirection?: string;
  windScale?: string;
  windSpeed?: string;
  humidity?: string;
  precipitation?: string;
  pressure?: string;
  visibility?: string;
  cloudCover?: string;
  dewPoint?: string;
  fetchedAt: string;
}
