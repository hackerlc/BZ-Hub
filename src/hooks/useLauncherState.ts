import { useCallback, useEffect, useRef, useState } from "react";
import { createDefaultState } from "../data/defaultState";
import { createId } from "../lib/id";
import { loadLauncherState, saveLauncherState } from "../lib/storage";
import type { CalendarEntry, Category, DevicePreferences, LauncherState, LaunchItem, SharedPreferences } from "../types";

export function useLauncherState() {
  const [state, setState] = useState<LauncherState>(createDefaultState);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<{ id: number; message: string } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const storageErrorSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void loadLauncherState().then((loaded) => {
      if (!active) return;
      setState(loaded);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveLauncherState(state)
        .then(() => setStorageError(null))
        .catch((error) => {
          const cause = error instanceof Error ? error.message : String(error);
          storageErrorSequence.current += 1;
          setStorageError({ id: storageErrorSequence.current, message: `本地保存失败：${cause}` });
        });
    }, 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [ready, state]);

  const upsertItem = useCallback((item: LaunchItem) => {
    setState((current) => {
      const exists = current.items.some((entry) => entry.id === item.id);
      return {
        ...current,
        items: exists
          ? current.items.map((entry) => (entry.id === item.id ? item : entry))
          : [...current.items, item],
      };
    });
  }, []);

  const removeItem = useCallback((itemId: string) => {
    const deletedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? { ...item, deletedAt, updatedAt: deletedAt } : item,
      ),
    }));
  }, []);

  const reorderItems = useCallback((draggedId: string, targetId: string, placement: "before" | "after") => {
    if (draggedId === targetId) return;

    setState((current) => {
      const ordered = current.items
        .filter((item) => !item.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const draggedIndex = ordered.findIndex((item) => item.id === draggedId);
      if (draggedIndex < 0 || !ordered.some((item) => item.id === targetId)) return current;

      const [dragged] = ordered.splice(draggedIndex, 1);
      const targetIndex = ordered.findIndex((item) => item.id === targetId);
      ordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, dragged);

      const nextOrder = new Map(ordered.map((item, index) => [item.id, index]));
      const updatedAt = new Date().toISOString();
      return {
        ...current,
        items: current.items.map((item) => {
          const sortOrder = nextOrder.get(item.id);
          if (sortOrder === undefined || sortOrder === item.sortOrder) return item;
          return { ...item, sortOrder, updatedAt };
        }),
      };
    });
  }, []);

  const recordLaunch = useCallback((itemId: string) => {
    setState((current) => ({
      ...current,
      events: [
        ...current.events,
        {
          id: createId(),
          itemId,
          deviceId: current.deviceId,
          openedAt: new Date().toISOString(),
        },
      ],
    }));
  }, []);

  const upsertCalendarEntry = useCallback((entry: CalendarEntry) => {
    setState((current) => {
      const exists = current.calendarEntries.some((candidate) => candidate.id === entry.id);
      return {
        ...current,
        calendarEntries: exists
          ? current.calendarEntries.map((candidate) => candidate.id === entry.id ? entry : candidate)
          : [...current.calendarEntries, entry],
      };
    });
  }, []);

  const removeCalendarEntry = useCallback((entryId: string) => {
    const deletedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      calendarEntries: current.calendarEntries.map((entry) => entry.id === entryId
        ? { ...entry, deletedAt, updatedAt: deletedAt }
        : entry),
    }));
  }, []);

  const toggleCalendarEntry = useCallback((entryId: string) => {
    const updatedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      calendarEntries: current.calendarEntries.map((entry) => entry.id === entryId
        ? { ...entry, completed: !entry.completed, updatedAt }
        : entry),
    }));
  }, []);

  const upsertCategory = useCallback((category: Category) => {
    setState((current) => {
      const exists = current.categories.some((entry) => entry.id === category.id);
      return {
        ...current,
        categories: exists
          ? current.categories.map((entry) => (entry.id === category.id ? category : entry))
          : [...current.categories, category],
      };
    });
  }, []);

  const removeCategory = useCallback((categoryId: string) => {
    setState((current) => {
      const now = new Date().toISOString();
      const fallback = current.categories.find((category) => !category.deletedAt && category.id !== categoryId);
      if (!fallback) return current;
      return {
        ...current,
        categories: current.categories.map((category) =>
          category.id === categoryId ? { ...category, deletedAt: now, updatedAt: now } : category,
        ),
        items: current.items.map((item) =>
          item.categoryId === categoryId ? { ...item, categoryId: fallback.id, updatedAt: now } : item,
        ),
      };
    });
  }, []);

  const updateSharedPreferences = useCallback((patch: Partial<Omit<SharedPreferences, "updatedAt">>) => {
    setState((current) => ({
      ...current,
      sharedPreferences: {
        ...current.sharedPreferences,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  const updateDevicePreferences = useCallback((patch: Partial<DevicePreferences>) => {
    setState((current) => ({
      ...current,
      devicePreferences: { ...current.devicePreferences, ...patch },
    }));
  }, []);

  const replaceState = useCallback((nextState: LauncherState) => setState(nextState), []);

  return {
    state,
    ready,
    storageError,
    setState,
    upsertItem,
    removeItem,
    reorderItems,
    recordLaunch,
    upsertCalendarEntry,
    removeCalendarEntry,
    toggleCalendarEntry,
    upsertCategory,
    removeCategory,
    updateSharedPreferences,
    updateDevicePreferences,
    replaceState,
  };
}
