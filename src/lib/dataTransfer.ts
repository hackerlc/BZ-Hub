import { createDefaultState } from "../data/defaultState";
import type { CloudLauncherState, LauncherState } from "../types";
import { mergeCloudState, toCloudState } from "./cloudMerge";
import { normalizeLauncherState } from "./storage";

export type ImportMode = "merge" | "replace";

export interface LauncherExportFile {
  format: "bz-hub-launcher-data";
  version: 1;
  exportedAt: string;
  data: CloudLauncherState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecordArray(
  value: unknown,
  label: string,
  requiredStrings: string[],
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`导入文件缺少${label}数据`);
  value.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${label}第 ${index + 1} 项不是有效对象`);
    for (const field of requiredStrings) {
      if (typeof entry[field] !== "string" || !String(entry[field]).trim()) {
        throw new Error(`${label}第 ${index + 1} 项缺少 ${field}`);
      }
    }
  });
  return value as Array<Record<string, unknown>>;
}

function normalizeCloudData(value: unknown): CloudLauncherState {
  if (!isRecord(value)) throw new Error("导入文件中的 data 不是有效对象");
  requireRecordArray(value.categories, "分类", ["id", "name", "updatedAt"]);
  requireRecordArray(value.items, "入口", ["id", "name", "categoryId", "updatedAt"]);
  requireRecordArray(value.events, "启动记录", ["id", "itemId", "openedAt"]);
  requireRecordArray(value.calendarEntries ?? [], "日历事项", ["id", "title", "date", "updatedAt"]);
  if (!isRecord(value.sharedPreferences)) throw new Error("导入文件缺少共享设置");
  if (typeof value.sharedPreferences.updatedAt !== "string") throw new Error("导入文件的共享设置缺少 updatedAt");

  const fallback = createDefaultState();
  const normalized = normalizeLauncherState({
    ...fallback,
    version: 1,
    categories: value.categories,
    items: value.items,
    events: value.events,
    calendarEntries: value.calendarEntries ?? [],
    sharedPreferences: value.sharedPreferences,
  });
  if (!normalized.categories.some((category) => !category.deletedAt)) {
    throw new Error("导入文件中没有可用分类");
  }
  return toCloudState(normalized);
}

export function createLauncherExport(state: LauncherState): LauncherExportFile {
  return {
    format: "bz-hub-launcher-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: toCloudState(state),
  };
}

export function parseLauncherExport(contents: string): CloudLauncherState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`JSON 格式不正确：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error("导入文件不是有效的 JSON 对象");

  if (parsed.format === "bz-hub-launcher-data") {
    if (parsed.version !== 1) throw new Error(`暂不支持导出格式版本 ${String(parsed.version)}`);
    return normalizeCloudData(parsed.data);
  }

  if (parsed.version === 1 && Array.isArray(parsed.items) && Array.isArray(parsed.categories)) {
    return normalizeCloudData(parsed);
  }
  throw new Error("这不是 BZ Hub 导出的数据文件");
}

export function applyLauncherImport(
  current: LauncherState,
  imported: CloudLauncherState,
  mode: ImportMode,
): LauncherState {
  if (mode === "merge") return mergeCloudState(current, imported);
  const normalized = normalizeCloudData(imported);
  return {
    ...current,
    categories: normalized.categories,
    items: normalized.items,
    events: normalized.events,
    calendarEntries: normalized.calendarEntries,
    sharedPreferences: normalized.sharedPreferences,
    syncMeta: { ...current.syncMeta, lastError: undefined },
  };
}
