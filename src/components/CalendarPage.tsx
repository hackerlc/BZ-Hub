import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  Flag,
  Link2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { CalendarEntry, CalendarEntryImportance, LaunchItem } from "../types";
import { createId } from "../lib/id";
import {
  compareCalendarEntries,
  isLocalDateKey,
  parseLocalDateKey,
} from "../lib/calendarEntries";
import {
  calendarMonthCells,
  importantFestivalFor,
  loadHolidayYear,
  localDateKey,
  type ChinaHolidayDay,
  type HolidayYearLoadResult,
} from "../lib/holidays";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const MIN_MONTH = 1900 * 12;
const MAX_MONTH = 2100 * 12 + 11;
const RANGE_STEP = 4;

export interface CalendarFocusRequest {
  id: number;
  date: string;
  openDay?: boolean;
}

interface CalendarPageProps {
  today: Date;
  entries: CalendarEntry[];
  launchItems: LaunchItem[];
  focusRequest: CalendarFocusRequest;
  onSaveEntry: (entry: CalendarEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  onToggleEntry: (entryId: string) => void;
  onLaunchItem: (item: LaunchItem) => void;
  onNotify: (message: string, type?: "success" | "error") => void;
}

interface CalendarMonthCardProps {
  month: Date;
  todayKey: string;
  selectedDate: string | null;
  entriesByDate: ReadonlyMap<string, CalendarEntry[]>;
  officialDays: ReadonlyMap<string, ChinaHolidayDay>;
  onSelectDate: (date: string) => void;
}

interface DraftEntry {
  id?: string;
  title: string;
  date: string;
  time: string;
  note: string;
  importance: CalendarEntryImportance;
  completed: boolean;
  linkedItemId: string;
  createdAt?: string;
}

function monthSerial(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function serialToMonth(serial: number): Date {
  return new Date(Math.floor(serial / 12), serial % 12, 1, 12);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
}

function fullDateTitle(dateKey: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(parseLocalDateKey(dateKey));
}

function emptyDraft(date: string): DraftEntry {
  return {
    title: "",
    date,
    time: "",
    note: "",
    importance: "normal",
    completed: false,
    linkedItemId: "",
  };
}

function draftFromEntry(entry: CalendarEntry): DraftEntry {
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    time: entry.time ?? "",
    note: entry.note ?? "",
    importance: entry.importance,
    completed: entry.completed,
    linkedItemId: entry.linkedItemId ?? "",
    createdAt: entry.createdAt,
  };
}

const CalendarMonthCard = memo(function CalendarMonthCard({
  month,
  todayKey,
  selectedDate,
  entriesByDate,
  officialDays,
  onSelectDate,
}: CalendarMonthCardProps) {
  const monthIndex = month.getMonth();
  const cells = calendarMonthCells(month);
  const activeMonthEntries = [...entriesByDate.entries()]
    .filter(([date]) => date.startsWith(`${monthKey(month)}-`))
    .reduce((count, [, entries]) => count + entries.length, 0);

  return (
    <section className="calendar-page__month" data-month-key={monthKey(month)} aria-label={monthTitle(month)}>
      <header>
        <strong>{monthTitle(month)}</strong>
        <span>{activeMonthEntries ? `${activeMonthEntries} 项事宜` : "暂无事宜"}</span>
      </header>
      <div className="calendar-page__weekdays" aria-hidden="true">
        {weekdays.map((weekday, index) => (
          <span className={index > 4 ? "is-weekend" : ""} key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="calendar-page__days">
        {cells.map((date) => {
          const key = localDateKey(date);
          const outside = date.getMonth() !== monthIndex;
          if (outside) return <span className="calendar-page__day is-outside" key={key} aria-hidden="true" />;

          const official = officialDays.get(key);
          const festival = importantFestivalFor(date);
          const label = official?.name ?? festival;
          const dayEntries = entriesByDate.get(key) ?? [];
          const incompleteEntries = dayEntries.filter((entry) => !entry.completed);
          const hasImportant = incompleteEntries.some((entry) => entry.importance === "important");
          const weekend = date.getDay() === 0 || date.getDay() === 6;
          const classes = [
            "calendar-page__day",
            weekend && "is-weekend",
            key === todayKey && "is-today",
            key === selectedDate && "is-selected",
            official?.isOffDay && "is-off-day",
            official && !official.isOffDay && "is-workday",
            label && !official && "has-festival",
            dayEntries.length && "has-entry",
            hasImportant && "has-important-entry",
          ].filter(Boolean).join(" ");
          const status = official ? (official.isOffDay ? "法定休息" : "调休上班") : undefined;
          const entryLabel = dayEntries.length ? `${dayEntries.length} 项事宜` : undefined;
          const accessibleLabel = [
            `${date.getMonth() + 1}月${date.getDate()}日`,
            label,
            status,
            entryLabel,
          ].filter(Boolean).join("，");

          return (
            <button
              type="button"
              className={classes}
              key={key}
              aria-label={accessibleLabel}
              aria-current={key === todayKey ? "date" : undefined}
              title={accessibleLabel}
              onClick={() => onSelectDate(key)}
            >
              <b>{date.getDate()}</b>
              {label && <small>{label}</small>}
              {official && <i>{official.isOffDay ? "休" : "班"}</i>}
              {dayEntries.length > 0 && (
                <span className={`calendar-page__entry-mark ${hasImportant ? "is-important" : ""}`}>
                  <em />{dayEntries.length > 1 ? dayEntries.length : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
});

interface DayPanelProps {
  date: string;
  entries: CalendarEntry[];
  launchItems: LaunchItem[];
  officialDay?: ChinaHolidayDay;
  onClose: () => void;
  onSave: (entry: CalendarEntry) => void;
  onDelete: (entryId: string) => void;
  onToggle: (entryId: string) => void;
  onLaunchItem: (item: LaunchItem) => void;
  onNotify: CalendarPageProps["onNotify"];
}

function CalendarDayPanel({
  date,
  entries,
  launchItems,
  officialDay,
  onClose,
  onSave,
  onDelete,
  onToggle,
  onLaunchItem,
  onNotify,
}: DayPanelProps) {
  const [draft, setDraft] = useState<DraftEntry>(() => emptyDraft(date));
  const [error, setError] = useState("");
  const festival = importantFestivalFor(parseLocalDateKey(date));

  useEffect(() => {
    setDraft(emptyDraft(date));
    setError("");
  }, [date]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  const saveDraft = (event: React.FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError("请输入事宜名称");
      return;
    }
    if (!isLocalDateKey(draft.date)) {
      setError("请选择有效日期");
      return;
    }

    const updatedAt = new Date().toISOString();
    onSave({
      id: draft.id ?? createId(),
      title,
      date: draft.date,
      time: draft.time || undefined,
      note: draft.note.trim() || undefined,
      importance: draft.importance,
      completed: draft.completed,
      linkedItemId: draft.linkedItemId || undefined,
      createdAt: draft.createdAt ?? updatedAt,
      updatedAt,
    });
    onNotify(draft.id ? "事宜已更新" : "事宜已添加");
    setDraft(emptyDraft(date));
    setError("");
  };

  const deleteDraft = () => {
    if (!draft.id) return;
    if (!window.confirm(`确定删除“${draft.title}”吗？`)) return;
    onDelete(draft.id);
    onNotify("事宜已删除");
    setDraft(emptyDraft(date));
  };

  return (
    <>
      <button type="button" className="calendar-day-panel__backdrop" onClick={onClose} aria-label="关闭日期面板" />
      <aside className="calendar-day-panel" aria-label={`${fullDateTitle(date)}的事宜`}>
        <header className="calendar-day-panel__header">
          <span><CalendarClock size={18} /></span>
          <div>
            <small>{officialDay?.name ?? festival ?? "日程安排"}</small>
            <strong>{fullDateTitle(date)}</strong>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>

        <div className="calendar-day-panel__body">
          <section className="calendar-day-panel__list">
            <header>
              <strong>当天事宜</strong>
              <span>{entries.length} 项</span>
            </header>
            {entries.length ? entries.map((entry) => {
              const linkedItem = entry.linkedItemId
                ? launchItems.find((item) => item.id === entry.linkedItemId)
                : undefined;
              return (
                <article
                  className={`calendar-entry-card ${entry.importance === "important" ? "is-important" : ""} ${entry.completed ? "is-completed" : ""} ${draft.id === entry.id ? "is-editing" : ""}`}
                  key={entry.id}
                >
                  <button
                    type="button"
                    className="calendar-entry-card__check"
                    onClick={() => {
                      onToggle(entry.id);
                      setDraft((current) => current.id === entry.id
                        ? { ...current, completed: !current.completed }
                        : current);
                    }}
                    title={entry.completed ? "标为未完成" : "标为已完成"}
                  >
                    {entry.completed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                  </button>
                  <button type="button" className="calendar-entry-card__content" onClick={() => { setDraft(draftFromEntry(entry)); setError(""); }}>
                    <span>
                      {entry.importance === "important" && <Flag size={11} />}
                      <strong>{entry.title}</strong>
                    </span>
                    <small>{entry.time || "全天"}{entry.note ? ` · ${entry.note}` : ""}</small>
                  </button>
                  {linkedItem && (
                    <button
                      type="button"
                      className="calendar-entry-card__launch"
                      onClick={() => onLaunchItem(linkedItem)}
                      title={`打开 ${linkedItem.name}`}
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                </article>
              );
            }) : (
              <div className="calendar-day-panel__empty">
                <CalendarDays size={18} />
                <span>这一天还没有安排</span>
              </div>
            )}
          </section>

          <form className="calendar-entry-form" onSubmit={saveDraft}>
            <header>
              <div>
                <span className="eyebrow">{draft.id ? "EDIT EVENT" : "NEW EVENT"}</span>
                <strong>{draft.id ? "编辑事宜" : "添加事宜"}</strong>
              </div>
              {draft.id && (
                <button type="button" className="text-button" onClick={() => { setDraft(emptyDraft(date)); setError(""); }}>
                  <Plus size={13} /> 新建
                </button>
              )}
            </header>

            <label className="field">
              <span>事宜名称</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="例如：提交季度方案"
                maxLength={120}
                autoFocus={!entries.length}
              />
            </label>

            <div className="calendar-entry-form__row">
              <label className="field">
                <span>日期</span>
                <input
                  type="date"
                  value={draft.date}
                  min="1900-01-01"
                  max="2100-12-31"
                  onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>时间 <small>可选</small></span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
                />
              </label>
            </div>

            <fieldset className="calendar-entry-importance">
              <legend>重要程度</legend>
              <div>
                <button
                  type="button"
                  className={draft.importance === "normal" ? "is-active" : ""}
                  onClick={() => setDraft((current) => ({ ...current, importance: "normal" }))}
                >
                  <Circle size={12} /> 普通
                </button>
                <button
                  type="button"
                  className={draft.importance === "important" ? "is-active is-important" : ""}
                  onClick={() => setDraft((current) => ({ ...current, importance: "important" }))}
                >
                  <Flag size={12} /> 重要
                </button>
              </div>
            </fieldset>

            <label className="field">
              <span>关联入口 <small>可选</small></span>
              <select
                value={draft.linkedItemId}
                onChange={(event) => setDraft((current) => ({ ...current, linkedItemId: event.target.value }))}
              >
                <option value="">不关联入口</option>
                {launchItems.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>

            <label className="field">
              <span>备注 <small>可选</small></span>
              <textarea
                value={draft.note}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="补充地点、准备内容或说明…"
                maxLength={2_000}
              />
            </label>

            <label className="calendar-entry-completed">
              <input
                type="checkbox"
                checked={draft.completed}
                onChange={(event) => setDraft((current) => ({ ...current, completed: event.target.checked }))}
              />
              <span><Check size={12} /> 已完成</span>
            </label>

            {error && <p className="form-error">{error}</p>}
            <footer>
              {draft.id ? (
                <button type="button" className="button button--danger-ghost" onClick={deleteDraft}>
                  <Trash2 size={13} /> 删除
                </button>
              ) : <span />}
              <button type="submit" className="button button--primary">
                <Check size={13} /> {draft.id ? "保存修改" : "添加事宜"}
              </button>
            </footer>
          </form>
        </div>
      </aside>
    </>
  );
}

export function CalendarPage({
  today,
  entries,
  launchItems,
  focusRequest,
  onSaveEntry,
  onDeleteEntry,
  onToggleEntry,
  onLaunchItem,
  onNotify,
}: CalendarPageProps) {
  const currentMonth = monthSerial(today);
  const [rangeStart, setRangeStart] = useState(() => Math.max(MIN_MONTH, currentMonth - 2));
  const [rangeEnd, setRangeEnd] = useState(() => Math.min(MAX_MONTH, currentMonth + 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(today.getMonth() + 1);
  const [query, setQuery] = useState("");
  const [holidayResults, setHolidayResults] = useState<Map<number, HolidayYearLoadResult>>(() => new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const prependRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const rangeChangingRef = useRef(false);
  const loadingYearsRef = useRef(new Set<number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const months = useMemo(() => Array.from(
    { length: rangeEnd - rangeStart + 1 },
    (_, index) => serialToMonth(rangeStart + index),
  ), [rangeEnd, rangeStart]);

  const activeEntries = useMemo(() => entries.filter((entry) => !entry.deletedAt), [entries]);
  const entriesByDate = useMemo(() => {
    const result = new Map<string, CalendarEntry[]>();
    activeEntries.forEach((entry) => {
      const dateEntries = result.get(entry.date) ?? [];
      dateEntries.push(entry);
      result.set(entry.date, dateEntries);
    });
    result.forEach((dateEntries) => dateEntries.sort(compareCalendarEntries));
    return result;
  }, [activeEntries]);

  const visibleYears = useMemo(() => Array.from(new Set(months.map((month) => month.getFullYear()))), [months]);

  useEffect(() => {
    const missing = visibleYears.filter((year) => !holidayResults.has(year) && !loadingYearsRef.current.has(year));
    if (!missing.length) return;
    missing.forEach((year) => loadingYearsRef.current.add(year));
    void Promise.all(missing.map(async (year) => ({ year, result: await loadHolidayYear(year) })))
      .then((loaded) => {
        if (!mountedRef.current) return;
        setHolidayResults((current) => {
          const next = new Map(current);
          loaded.forEach(({ year, result }) => next.set(year, result));
          return next;
        });
      })
      .finally(() => missing.forEach((year) => loadingYearsRef.current.delete(year)));
  }, [holidayResults, visibleYears]);

  const officialDays = useMemo(() => new Map(
    [...holidayResults.values()].flatMap((result) => result.data.days).map((day) => [day.date, day]),
  ), [holidayResults]);

  const focusDate = useCallback((dateKey: string, openDay = false) => {
    if (!isLocalDateKey(dateKey)) return;
    const serial = monthSerial(parseLocalDateKey(dateKey));
    pendingFocusRef.current = dateKey;
    if (serial < rangeStart || serial > rangeEnd) {
      setRangeStart(Math.max(MIN_MONTH, serial - 2));
      setRangeEnd(Math.min(MAX_MONTH, serial + 7));
    } else {
      window.requestAnimationFrame(() => {
        const scroll = scrollRef.current;
        const target = scroll?.querySelector<HTMLElement>(`[data-month-key="${dateKey.slice(0, 7)}"]`);
        if (scroll && target) scroll.scrollTo({ top: Math.max(0, target.offsetTop - 4), behavior: "smooth" });
        pendingFocusRef.current = null;
      });
    }
    setPickerYear(parseLocalDateKey(dateKey).getFullYear());
    setPickerMonth(parseLocalDateKey(dateKey).getMonth() + 1);
    if (openDay) setSelectedDate(dateKey);
  }, [rangeEnd, rangeStart]);

  useEffect(() => {
    focusDate(focusRequest.date, focusRequest.openDay);
  }, [focusRequest.id]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const restore = prependRestoreRef.current;
    if (restore) {
      scroll.scrollTop = restore.top + (scroll.scrollHeight - restore.height);
      prependRestoreRef.current = null;
    }

    const pendingFocus = pendingFocusRef.current;
    if (pendingFocus) {
      const target = scroll.querySelector<HTMLElement>(`[data-month-key="${pendingFocus.slice(0, 7)}"]`);
      if (target) {
        scroll.scrollTop = Math.max(0, target.offsetTop - 4);
        pendingFocusRef.current = null;
      }
    }
    rangeChangingRef.current = false;
  }, [rangeEnd, rangeStart]);

  const updateVisiblePicker = useCallback((scroll: HTMLDivElement) => {
    const containerTop = scroll.getBoundingClientRect().top;
    const cards = [...scroll.querySelectorAll<HTMLElement>("[data-month-key]")];
    const firstVisible = cards.find((card) => card.getBoundingClientRect().bottom > containerTop + 40);
    const key = firstVisible?.dataset.monthKey;
    if (!key) return;
    const [year, month] = key.split("-").map(Number);
    setPickerYear(year);
    setPickerMonth(month);
  }, []);

  const handleScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    updateVisiblePicker(scroll);
    if (rangeChangingRef.current) return;

    if (scroll.scrollTop < 48 && rangeStart > MIN_MONTH) {
      rangeChangingRef.current = true;
      prependRestoreRef.current = { height: scroll.scrollHeight, top: scroll.scrollTop };
      setRangeStart((current) => Math.max(MIN_MONTH, current - RANGE_STEP));
      return;
    }
    if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 180 && rangeEnd < MAX_MONTH) {
      rangeChangingRef.current = true;
      setRangeEnd((current) => Math.min(MAX_MONTH, current + RANGE_STEP));
    }
  }, [rangeEnd, rangeStart, updateVisiblePicker]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return activeEntries
      .filter((entry) => `${entry.title} ${entry.note ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort(compareCalendarEntries);
  }, [activeEntries, query]);

  const selectedEntries = selectedDate ? entriesByDate.get(selectedDate) ?? [] : [];
  const holidayErrors = visibleYears
    .map((year) => holidayResults.get(year)?.error)
    .filter(Boolean) as string[];

  return (
    <section className="calendar-page">
      <header className="calendar-page__toolbar">
        <div className="calendar-page__heading">
          <span><CalendarDays size={18} /></span>
          <div>
            <strong>日历与事宜</strong>
            <small>{activeEntries.filter((entry) => !entry.completed).length} 项待完成</small>
          </div>
        </div>

        <label className="calendar-page__search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事宜…" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={12} /></button>}
        </label>

        <div className="calendar-page__picker">
          <input
            type="number"
            min={1900}
            max={2100}
            value={pickerYear}
            aria-label="年份"
            onChange={(event) => setPickerYear(Math.min(2100, Math.max(1900, Number(event.target.value) || today.getFullYear())))}
          />
          <select value={pickerMonth} aria-label="月份" onChange={(event) => setPickerMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} 月</option>)}
          </select>
          <button type="button" onClick={() => focusDate(`${pickerYear}-${String(pickerMonth).padStart(2, "0")}-01`)}>
            前往
          </button>
          <button type="button" className="is-today" onClick={() => focusDate(localDateKey(today))}>今天</button>
        </div>
      </header>

      {query.trim() ? (
        <div className="calendar-page__search-results">
          <header><strong>搜索结果</strong><span>{filteredEntries.length} 项</span></header>
          {filteredEntries.length ? filteredEntries.map((entry) => (
            <button type="button" key={entry.id} onClick={() => { setQuery(""); focusDate(entry.date, true); }}>
              <span className={entry.importance === "important" ? "is-important" : ""}>
                {entry.importance === "important" ? <Flag size={13} /> : <CalendarClock size={13} />}
              </span>
              <div>
                <strong>{entry.title}</strong>
                <small>{fullDateTitle(entry.date)}{entry.time ? ` · ${entry.time}` : " · 全天"}</small>
              </div>
              {entry.completed && <em>已完成</em>}
              <ChevronRight size={14} />
            </button>
          )) : (
            <div className="calendar-page__no-results"><Search size={20} /><span>没有找到匹配事宜</span></div>
          )}
        </div>
      ) : (
        <div className="calendar-page__viewport" ref={scrollRef} onScroll={handleScroll}>
          <button
            type="button"
            className="calendar-page__load-more"
            onClick={() => {
              const scroll = scrollRef.current;
              if (!scroll || rangeStart <= MIN_MONTH) return;
              rangeChangingRef.current = true;
              prependRestoreRef.current = { height: scroll.scrollHeight, top: scroll.scrollTop };
              setRangeStart((current) => Math.max(MIN_MONTH, current - RANGE_STEP));
            }}
          >加载更早月份</button>
          <div className="calendar-page__months">
            {months.map((month) => (
              <CalendarMonthCard
                key={monthKey(month)}
                month={month}
                todayKey={localDateKey(today)}
                selectedDate={selectedDate}
                entriesByDate={entriesByDate}
                officialDays={officialDays}
                onSelectDate={setSelectedDate}
              />
            ))}
          </div>
          <button
            type="button"
            className="calendar-page__load-more"
            onClick={() => setRangeEnd((current) => Math.min(MAX_MONTH, current + RANGE_STEP))}
          >继续加载后续月份</button>
          <footer className="calendar-page__source" title={holidayErrors.join("；") || undefined}>
            {visibleYears.some((year) => !holidayResults.has(year))
              ? "正在加载节假日信息…"
              : holidayErrors.length
                ? "部分法定调休数据不可用，已显示本地节日"
                : "已显示重要节日与法定调休"}
          </footer>
        </div>
      )}

      {selectedDate && (
        <CalendarDayPanel
          date={selectedDate}
          entries={selectedEntries}
          launchItems={launchItems}
          officialDay={officialDays.get(selectedDate)}
          onClose={() => setSelectedDate(null)}
          onSave={onSaveEntry}
          onDelete={onDeleteEntry}
          onToggle={onToggleEntry}
          onLaunchItem={onLaunchItem}
          onNotify={onNotify}
        />
      )}
    </section>
  );
}
