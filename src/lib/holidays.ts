import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./platform";

export interface ChinaHolidayDay {
  name: string;
  date: string;
  isOffDay: boolean;
}

export interface ChinaHolidayYear {
  year: number;
  papers: string[];
  days: ChinaHolidayDay[];
}

export interface HolidayYearLoadResult {
  data: ChinaHolidayYear;
  source: "network" | "cache" | "fallback";
  error?: string;
}

interface HolidayCacheEntry {
  version: 1;
  savedAt: number;
  data: ChinaHolidayYear;
}

const CACHE_PREFIX = "bz-hub-cn-holidays-v1";
const PUBLISHED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const UNPUBLISHED_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const solarFestivals = new Map<string, string>([
  ["1-1", "元旦"],
  ["3-8", "妇女节"],
  ["5-1", "劳动节"],
  ["5-4", "青年节"],
  ["6-1", "儿童节"],
  ["8-1", "建军节"],
  ["9-10", "教师节"],
  ["10-1", "国庆节"],
  ["12-25", "圣诞节"],
]);

const lunarFestivals = new Map<string, string>([
  ["1-1", "春节"],
  ["1-15", "元宵节"],
  ["5-5", "端午节"],
  ["7-7", "七夕"],
  ["8-15", "中秋节"],
  ["9-9", "重阳节"],
  ["12-8", "腊八节"],
]);

let lunarFormatter: Intl.DateTimeFormat | null | undefined;
const inFlightYearLoads = new Map<number, Promise<HolidayYearLoadResult>>();

function emptyHolidayYear(year: number): ChinaHolidayYear {
  return { year, papers: [], days: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function isValidHolidayYear(value: unknown, expectedYear: number): value is ChinaHolidayYear {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChinaHolidayYear>;
  if (candidate.year !== expectedYear || !Array.isArray(candidate.papers) || !Array.isArray(candidate.days)) return false;
  return candidate.papers.every((paper) => typeof paper === "string")
    && candidate.days.every((day) => Boolean(
      day
      && typeof day.name === "string"
      && day.name.length > 0
      && day.name.length <= 32
      && typeof day.date === "string"
      && new RegExp(`^${expectedYear}-\\d{2}-\\d{2}$`).test(day.date)
      && typeof day.isOffDay === "boolean",
    ));
}

function readHolidayCache(year: number): HolidayCacheEntry | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}-${year}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<HolidayCacheEntry>;
    if (entry.version !== 1 || typeof entry.savedAt !== "number" || !isValidHolidayYear(entry.data, year)) return null;
    return entry as HolidayCacheEntry;
  } catch {
    return null;
  }
}

function writeHolidayCache(data: ChinaHolidayYear): void {
  try {
    const entry: HolidayCacheEntry = { version: 1, savedAt: Date.now(), data };
    localStorage.setItem(`${CACHE_PREFIX}-${data.year}`, JSON.stringify(entry));
  } catch {
    // 日历仍可使用内置节日，缓存失败不应影响主界面。
  }
}

async function requestHolidayYear(year: number): Promise<ChinaHolidayYear> {
  let result: unknown;
  if (isTauriRuntime()) {
    result = await invoke<ChinaHolidayYear>("fetch_china_holidays", { year });
  } else {
    const response = await fetch(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`);
    if (!response.ok) throw new Error(`节假日服务返回 ${response.status}`);
    result = await response.json();
  }
  if (!isValidHolidayYear(result, year)) throw new Error("节假日数据格式不正确");
  return result;
}

export async function loadHolidayYear(year: number): Promise<HolidayYearLoadResult> {
  const cached = readHolidayCache(year);
  const cacheTtl = cached?.data.papers.length ? PUBLISHED_CACHE_TTL_MS : UNPUBLISHED_CACHE_TTL_MS;
  if (cached && Date.now() - cached.savedAt < cacheTtl) {
    return { data: cached.data, source: "cache" };
  }

  const existingRequest = inFlightYearLoads.get(year);
  if (existingRequest) return existingRequest;

  const request = (async (): Promise<HolidayYearLoadResult> => {
    try {
      const data = await requestHolidayYear(year);
      writeHolidayCache(data);
      return { data, source: "network" };
    } catch (error) {
      return {
        data: cached?.data ?? emptyHolidayYear(year),
        source: cached ? "cache" : "fallback",
        error: errorMessage(error),
      };
    } finally {
      inFlightYearLoads.delete(year);
    }
  })();
  inFlightYearLoads.set(year, request);
  return request;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lunarMonthDay(date: Date): string | null {
  try {
    lunarFormatter ??= new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      month: "numeric",
      day: "numeric",
    });
    const parts = lunarFormatter.formatToParts(date);
    const monthText = parts.find((part) => part.type === "month")?.value ?? "";
    const dayText = parts.find((part) => part.type === "day")?.value ?? "";
    if (monthText.includes("闰")) return null;
    const month = Number(monthText.replace(/\D/g, ""));
    const day = Number(dayText.replace(/\D/g, ""));
    return Number.isInteger(month) && Number.isInteger(day) ? `${month}-${day}` : null;
  } catch {
    lunarFormatter = null;
    return null;
  }
}

function qingmingDay(year: number): number {
  const shortYear = year % 100;
  const centuryConstant = year >= 2000 ? 4.81 : 5.59;
  const adjustment = year === 2008 ? 1 : 0;
  return Math.floor(shortYear * 0.2422 + centuryConstant) - Math.floor(shortYear / 4) + adjustment;
}

export function importantFestivalFor(date: Date): string | undefined {
  const solarKey = `${date.getMonth() + 1}-${date.getDate()}`;
  const solarFestival = solarFestivals.get(solarKey);
  if (solarFestival) return solarFestival;
  if (date.getMonth() === 3 && date.getDate() === qingmingDay(date.getFullYear())) return "清明节";

  const lunarKey = lunarMonthDay(date);
  const lunarFestival = lunarKey ? lunarFestivals.get(lunarKey) : undefined;
  if (lunarFestival) return lunarFestival;

  const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12);
  if (lunarMonthDay(tomorrow) === "1-1") return "除夕";
  return undefined;
}

export function calendarMonthCells(month: Date): Date[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1, 12);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => (
    new Date(year, monthIndex, index - mondayOffset + 1, 12)
  ));
}
