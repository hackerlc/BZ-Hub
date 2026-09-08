import type { CalendarEntry } from "../types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLocalDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

export function parseLocalDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function normalizeCalendarEntry(value: unknown): CalendarEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CalendarEntry>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.title !== "string" || !candidate.title.trim()) return null;
  if (!isLocalDateKey(candidate.date)) return null;

  const now = new Date().toISOString();
  const createdAt = typeof candidate.createdAt === "string" && candidate.createdAt
    ? candidate.createdAt
    : typeof candidate.updatedAt === "string" && candidate.updatedAt
      ? candidate.updatedAt
      : now;
  const updatedAt = typeof candidate.updatedAt === "string" && candidate.updatedAt
    ? candidate.updatedAt
    : createdAt;

  return {
    id: candidate.id,
    title: candidate.title.trim().slice(0, 120),
    date: candidate.date,
    time: typeof candidate.time === "string" && TIME_PATTERN.test(candidate.time)
      ? candidate.time
      : undefined,
    note: typeof candidate.note === "string" && candidate.note.trim()
      ? candidate.note.trim().slice(0, 2_000)
      : undefined,
    importance: candidate.importance === "important" ? "important" : "normal",
    completed: candidate.completed === true,
    linkedItemId: typeof candidate.linkedItemId === "string" && candidate.linkedItemId
      ? candidate.linkedItemId
      : undefined,
    createdAt,
    updatedAt,
    deletedAt: typeof candidate.deletedAt === "string" && candidate.deletedAt
      ? candidate.deletedAt
      : undefined,
  };
}

export function compareCalendarEntries(left: CalendarEntry, right: CalendarEntry): number {
  return left.date.localeCompare(right.date)
    || Number(right.importance === "important") - Number(left.importance === "important")
    || (left.time ?? "99:99").localeCompare(right.time ?? "99:99")
    || left.createdAt.localeCompare(right.createdAt);
}

export function daysFromToday(dateKey: string, today: Date): number {
  const target = parseLocalDateKey(dateKey);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function relativeDayLabel(days: number): string {
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days > 1) return `还有 ${days} 天`;
  return `已过 ${Math.abs(days)} 天`;
}
