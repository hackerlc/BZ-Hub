import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronRight } from "lucide-react";
import type { CalendarEntry } from "../types";
import { compareCalendarEntries, daysFromToday, relativeDayLabel } from "../lib/calendarEntries";
import {
  importantFestivalFor,
  loadHolidayYear,
  localDateKey,
  type HolidayYearLoadResult,
} from "../lib/holidays";

interface NextCalendarHighlightProps {
  entries: CalendarEntry[];
  today: Date;
  onOpen: (date: string) => void;
}

interface CalendarHighlight {
  date: string;
  title: string;
  detail: string;
  important: boolean;
}

function shortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" })
    .format(new Date(year, month - 1, day, 12));
}

export function NextCalendarHighlight({ entries, today, onOpen }: NextCalendarHighlightProps) {
  const todayKey = localDateKey(today);
  const upcomingImportant = useMemo(() => entries
    .filter((entry) => !entry.deletedAt
      && !entry.completed
      && entry.importance === "important"
      && entry.date >= todayKey)
    .sort(compareCalendarEntries), [entries, todayKey]);
  const [holidayYears, setHolidayYears] = useState<HolidayYearLoadResult[]>([]);

  useEffect(() => {
    if (upcomingImportant.length) return;
    let active = true;
    const years = [today.getFullYear(), today.getFullYear() + 1];
    void Promise.all(years.map(loadHolidayYear)).then((results) => {
      if (active) setHolidayYears(results);
    });
    return () => { active = false; };
  }, [today.getFullYear(), upcomingImportant.length]);

  const highlight = useMemo<CalendarHighlight | null>(() => {
    const first = upcomingImportant[0];
    if (first) {
      const sameDayCount = upcomingImportant.filter((entry) => entry.date === first.date).length;
      return {
        date: first.date,
        title: sameDayCount > 1 ? `${first.title} 等 ${sameDayCount} 项` : first.title,
        detail: relativeDayLabel(daysFromToday(first.date, today)),
        important: true,
      };
    }

    const officialDays = new Map(
      holidayYears.flatMap((result) => result.data.days).map((day) => [day.date, day]),
    );
    for (let offset = 0; offset <= 550; offset += 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12);
      const key = localDateKey(date);
      const official = officialDays.get(key);
      const festival = official?.isOffDay ? official.name : importantFestivalFor(date);
      if (!festival) continue;
      return {
        date: key,
        title: festival,
        detail: relativeDayLabel(offset),
        important: false,
      };
    }
    return null;
  }, [holidayYears, todayKey, upcomingImportant]);

  if (!highlight) {
    return <span className="hero__calendar-empty">日历中暂无重要事项</span>;
  }

  return (
    <button
      type="button"
      className={`hero__calendar-highlight ${highlight.important ? "is-important" : ""}`}
      onClick={() => onOpen(highlight.date)}
      title={`打开 ${highlight.date} 的日历`}
    >
      <CalendarClock size={11} />
      <span>{shortDate(highlight.date)} · {highlight.title}</span>
      <b>{highlight.detail}</b>
      <ChevronRight size={10} />
    </button>
  );
}
