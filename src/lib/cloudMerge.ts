import type {
  Category,
  CalendarEntry,
  CloudLauncherState,
  LauncherState,
  LaunchItem,
  SharedPreferences,
} from "../types";
import { normalizeLaunchItem } from "./targets";
import { normalizeCalendarEntry } from "./calendarEntries";

type Timestamped = { id: string; updatedAt: string };

function newestById<T extends Timestamped>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();

  for (const record of [...remote, ...local]) {
    const existing = merged.get(record.id);
    if (!existing || new Date(record.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      merged.set(record.id, record);
    }
  }

  return [...merged.values()];
}

function newestPreferences(local: SharedPreferences, remote: SharedPreferences): SharedPreferences {
  return new Date(local.updatedAt).getTime() >= new Date(remote.updatedAt).getTime() ? local : remote;
}

export function toCloudState(state: LauncherState): CloudLauncherState {
  return {
    version: 1,
    categories: state.categories,
    items: state.items,
    events: state.events,
    calendarEntries: state.calendarEntries,
    sharedPreferences: state.sharedPreferences,
  };
}

export function mergeCloudState(local: LauncherState, remote: CloudLauncherState): LauncherState {
  const eventMap = new Map(local.events.map((event) => [event.id, event]));
  for (const event of remote.events ?? []) eventMap.set(event.id, event);

  return {
    ...local,
    categories: newestById<Category>(local.categories, remote.categories ?? []),
    items: newestById<LaunchItem>(local.items, remote.items ?? []).map(normalizeLaunchItem),
    events: [...eventMap.values()].sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    calendarEntries: newestById<CalendarEntry>(
      local.calendarEntries,
      (remote.calendarEntries ?? [])
        .map(normalizeCalendarEntry)
        .filter((entry): entry is CalendarEntry => entry !== null),
    ),
    sharedPreferences: newestPreferences(local.sharedPreferences, remote.sharedPreferences),
  };
}
