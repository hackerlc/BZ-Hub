import type { CloudLauncherState, LauncherState } from "../types";
import { toCloudState } from "./cloudMerge";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function byId<T extends { id: string }>(records: T[]): T[] {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

export function cloudStateFingerprint(state: LauncherState | CloudLauncherState): string {
  const cloud = "deviceId" in state ? toCloudState(state) : state;
  return JSON.stringify(canonicalize({
    ...cloud,
    categories: byId(cloud.categories),
    items: byId(cloud.items),
    events: byId(cloud.events),
    calendarEntries: byId(cloud.calendarEntries ?? []),
  }));
}
