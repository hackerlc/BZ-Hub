import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  calendarMonthCells,
  importantFestivalFor,
  loadHolidayYear,
  localDateKey,
  type ChinaHolidayDay,
  type HolidayYearLoadResult,
} from "../lib/holidays";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

interface CalendarPopoverProps {
  today: Date;
}

interface CalendarMonthProps {
  month: Date;
  todayKey: string;
  officialDays: ReadonlyMap<string, ChinaHolidayDay>;
}

function CalendarMonth({ month, todayKey, officialDays }: CalendarMonthProps) {
  const monthIndex = month.getMonth();
  const cells = calendarMonthCells(month);
  const title = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(month);

  return (
    <section className="calendar-month" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>{monthIndex + 1 < 4 ? "第一季度" : monthIndex + 1 < 7 ? "第二季度" : monthIndex + 1 < 10 ? "第三季度" : "第四季度"}</span>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdays.map((weekday, index) => <span className={index > 4 ? "is-weekend" : ""} key={weekday}>{weekday}</span>)}
      </div>
      <div className="calendar-days">
        {cells.map((date) => {
          const key = localDateKey(date);
          const official = officialDays.get(key);
          const festival = importantFestivalFor(date);
          const label = official?.name ?? festival;
          const outside = date.getMonth() !== monthIndex;
          const weekend = date.getDay() === 0 || date.getDay() === 6;
          const classes = [
            "calendar-day",
            outside && "is-outside",
            weekend && "is-weekend",
            key === todayKey && "is-today",
            official?.isOffDay && "is-off-day",
            official && !official.isOffDay && "is-workday",
            label && !official && "has-festival",
          ].filter(Boolean).join(" ");
          const status = official ? (official.isOffDay ? "法定休息" : "调休上班") : undefined;
          const accessibleLabel = [
            `${date.getMonth() + 1}月${date.getDate()}日`,
            label,
            status,
          ].filter(Boolean).join("，");

          return (
            <span
              className={classes}
              key={key}
              aria-label={accessibleLabel}
              aria-current={key === todayKey ? "date" : undefined}
              title={accessibleLabel}
            >
              <b>{date.getDate()}</b>
              {label && <small>{label}</small>}
              {official && <i>{official.isOffDay ? "休" : "班"}</i>}
            </span>
          );
        })}
      </div>
    </section>
  );
}

export function CalendarPopover({ today }: CalendarPopoverProps) {
  const firstMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth(), 1, 12),
    [today.getFullYear(), today.getMonth()],
  );
  const secondMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + 1, 1, 12),
    [today.getFullYear(), today.getMonth()],
  );
  const years = useMemo(
    () => Array.from(new Set([firstMonth.getFullYear(), secondMonth.getFullYear()])),
    [firstMonth, secondMonth],
  );
  const [results, setResults] = useState<HolidayYearLoadResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all(years.map(loadHolidayYear)).then((loaded) => {
      if (!active) return;
      setResults(loaded);
      setLoading(false);
    });
    return () => { active = false; };
  }, [years]);

  const officialDays = useMemo(() => new Map(
    results.flatMap((result) => result.data.days).map((day) => [day.date, day]),
  ), [results]);
  const errors = results.map((result) => result.error).filter(Boolean) as string[];
  const hasPublishedSchedule = results.some((result) => result.data.papers.length > 0);
  const sourceLabel = loading
    ? "正在更新法定节假日…"
    : errors.length
      ? "在线调休数据暂不可用，已使用本地节日"
      : hasPublishedSchedule
        ? "法定放假与调休数据已更新"
        : "年度安排尚未发布，显示内置节日";

  return (
    <aside id="date-calendar" className="calendar-popover" role="tooltip" aria-label="本月和下月日历">
      <header className="calendar-popover__header">
        <span><CalendarDays size={16} /></span>
        <div>
          <strong>两月日历</strong>
          <small>重要节日与法定调休</small>
        </div>
        <time dateTime={localDateKey(today)}>今天 {today.getMonth() + 1}/{today.getDate()}</time>
      </header>

      <div className="calendar-months">
        <CalendarMonth month={firstMonth} todayKey={localDateKey(today)} officialDays={officialDays} />
        <CalendarMonth month={secondMonth} todayKey={localDateKey(today)} officialDays={officialDays} />
      </div>

      <footer className="calendar-popover__footer" title={errors.join("；") || undefined}>
        <span><i className="is-off">休</i> 法定休息</span>
        <span><i className="is-work">班</i> 调休上班</span>
        <small className={errors.length ? "has-error" : ""}>{sourceLabel}</small>
      </footer>
    </aside>
  );
}
