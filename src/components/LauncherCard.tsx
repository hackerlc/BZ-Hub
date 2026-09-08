import { useEffect, useRef } from "react";
import {
  AppWindow,
  Clock3,
  File,
  Folder,
  FolderKanban,
  Globe2,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Star,
} from "lucide-react";
import type { Category, DesktopPlatform, LaunchAction, LaunchItem, LaunchKind } from "../types";
import {
  actionTargetSummary,
  canLaunchAction,
  canLaunchOnPlatform,
  launchActionsFor,
  targetSummary,
} from "../lib/launcher";
import { DEFAULT_LINKED_TARGET_DELAY_MS } from "../lib/targets";
import { LaunchIcon } from "./LaunchIcon";

export type DropPlacement = "before" | "after";

interface LauncherCardProps {
  item: LaunchItem;
  category?: Category;
  platform: DesktopPlatform;
  usageCount: number;
  lastOpenedAt?: string;
  launching: boolean;
  onLaunch: () => void;
  onLaunchAction: (action: LaunchAction) => void;
  onEdit: () => void;
  dragging: boolean;
  dropPlacement?: DropPlacement;
  onPointerDragStart: () => void;
  onPointerDragMove: (clientX: number, clientY: number) => void;
  onPointerDragEnd: () => void;
}

interface PointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

function formatLastOpened(value?: string): string {
  if (!value) return "尚未打开";
  const opened = new Date(value);
  const difference = Date.now() - opened.getTime();
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "刚刚打开";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(opened);
}

function KindIcon({ kind, size = 13 }: { kind: LaunchKind; size?: number }) {
  const Icon = kind === "url"
    ? Globe2
    : kind === "application"
      ? AppWindow
      : kind === "project"
        ? FolderKanban
        : kind === "folder"
          ? Folder
          : File;
  return <Icon size={size} />;
}

export function LauncherCard({
  item,
  category,
  platform,
  usageCount,
  lastOpenedAt,
  launching,
  onLaunch,
  onLaunchAction,
  onEdit,
  dragging,
  dropPlacement,
  onPointerDragStart,
  onPointerDragMove,
  onPointerDragEnd,
}: LauncherCardProps) {
  const available = canLaunchOnPlatform(item, platform);
  const actions = launchActionsFor(item);
  const hasLinkedTargets = actions.length > 1;
  const batchActionCount = actions.filter((action, index) => index === 0 || action.includeInBatch !== false).length;
  const gestureRef = useRef<PointerGesture | null>(null);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    window.clearTimeout(longPressTimerRef.current);
    gestureCleanupRef.current?.();
  }, []);

  return (
    <article
      className={`launcher-card ${hasLinkedTargets ? "launcher-card--group" : ""} ${available ? "" : "launcher-card--disabled"} ${launching ? "launcher-card--launching" : ""} ${dragging ? "launcher-card--dragging" : ""} ${dropPlacement ? `launcher-card--drop-${dropPlacement}` : ""}`}
      style={{ "--item-color": item.color } as React.CSSProperties}
      data-launcher-item-id={item.id}
      aria-busy={launching}
      onPointerDown={(event) => {
        if (launching || !event.isPrimary || event.button !== 0) return;
        if ((event.target as HTMLElement).closest(".launcher-card__more, .launcher-card__action-panel")) return;

        gestureCleanupRef.current?.();
        const gesture: PointerGesture = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dragging: false,
        };
        gestureRef.current = gesture;

        const beginPointerDrag = () => {
          if (gestureRef.current !== gesture || gesture.dragging) return;
          gesture.dragging = true;
          suppressClickRef.current = true;
          onPointerDragStart();
        };
        const movePointerGesture = (pointerEvent: PointerEvent) => {
          if (gestureRef.current !== gesture || pointerEvent.pointerId !== gesture.pointerId) return;
          const distance = Math.hypot(pointerEvent.clientX - gesture.startX, pointerEvent.clientY - gesture.startY);
          if (!gesture.dragging && distance >= 7) beginPointerDrag();
          if (gesture.dragging) {
            pointerEvent.preventDefault();
            onPointerDragMove(pointerEvent.clientX, pointerEvent.clientY);
          }
        };
        const finishPointerGesture = (pointerEvent: PointerEvent) => {
          if (gestureRef.current !== gesture || pointerEvent.pointerId !== gesture.pointerId) return;
          window.clearTimeout(longPressTimerRef.current);
          gestureCleanupRef.current?.();
          gestureRef.current = null;
          if (!gesture.dragging) return;

          pointerEvent.preventDefault();
          onPointerDragEnd();
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 260);
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", movePointerGesture, true);
          window.removeEventListener("pointerup", finishPointerGesture, true);
          window.removeEventListener("pointercancel", finishPointerGesture, true);
          if (gestureCleanupRef.current === cleanup) gestureCleanupRef.current = null;
        };

        gestureCleanupRef.current = cleanup;
        window.addEventListener("pointermove", movePointerGesture, true);
        window.addEventListener("pointerup", finishPointerGesture, true);
        window.addEventListener("pointercancel", finishPointerGesture, true);
        longPressTimerRef.current = window.setTimeout(beginPointerDrag, 180);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!dragging && !launching) onEdit();
      }}
    >
      <button
        type="button"
        className="launcher-card__open"
        onClick={(event) => {
          if (suppressClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
            return;
          }
          onLaunch();
        }}
        disabled={!available || launching}
        aria-label={hasLinkedTargets ? `依次打开 ${item.name} 的 ${actions.length} 个目标` : `打开 ${item.name}`}
      >
        <span className="launcher-card__topline">
          <span className="launcher-card__icon">
            <LaunchIcon icon={item.icon} fallback={item.name} className="launcher-card__icon-asset" />
          </span>
          <span className="launcher-card__badges">
            {hasLinkedTargets && (
              <span className="launcher-card__group-badge">
                <Layers3 size={9} /> {batchActionCount === actions.length ? actions.length : `${batchActionCount}/${actions.length}`}
              </span>
            )}
            {item.scope !== "all" && <span>{item.scope === "windows" ? "WIN" : "MAC"}</span>}
          </span>
        </span>

        <span className="launcher-card__content">
          <span className="launcher-card__title">
            <strong>{item.name}</strong>
            {item.favorite && <Star className="launcher-card__favorite" size={13} fill="currentColor" aria-label="已收藏" />}
          </span>
          <span>{item.description || targetSummary(item, platform)}</span>
        </span>

        <span className="launcher-card__meta">
          <span className="launcher-card__category">
            <i style={{ background: category?.color ?? "#77819a" }} />
            {category?.name ?? "未分类"}
          </span>
          <span className="launcher-card__usage" title={`累计打开 ${usageCount} 次`}>
            <Clock3 size={11} /> {formatLastOpened(lastOpenedAt)}
          </span>
        </span>
      </button>

      <button type="button" className="launcher-card__more" onClick={onEdit} disabled={launching} aria-label={`编辑 ${item.name}`}>
        <MoreHorizontal size={17} />
      </button>

      {launching && (
        <span className="launcher-card__launch-feedback" role="status">
          <span><LoaderCircle size={13} className="spin" /> 正在打开</span>
        </span>
      )}

      {hasLinkedTargets && (
        <div className="launcher-card__action-panel" onPointerDown={(event) => event.stopPropagation()}>
          <div className="launcher-card__action-heading">
            <span>启动顺序</span>
            <small>卡片启动 {batchActionCount} 项</small>
          </div>
          {actions.map((action, index) => {
            const actionAvailable = canLaunchAction(action, platform);
            return (
              <button
                type="button"
                key={action.id}
                disabled={!actionAvailable || launching}
                onClick={(event) => {
                  event.stopPropagation();
                  onLaunchAction(action);
                }}
                title={actionTargetSummary(action, platform)}
              >
                <span className="launcher-card__action-index">{index + 1}</span>
                <span className="launcher-card__action-kind">
                  {action.icon
                    ? <LaunchIcon icon={action.icon} fallback={action.name} className="launcher-card__action-icon" />
                    : <KindIcon kind={action.kind} />}
                </span>
                <span className="launcher-card__action-copy">
                  <strong>{action.name}</strong>
                  <small>{actionTargetSummary(action, platform)}</small>
                </span>
                {index > 0 && action.includeInBatch === false
                  ? <span className="launcher-card__action-mode">单独</span>
                  : index > 0 && (
                    <span className="launcher-card__action-delay">
                      +{((action.delayMs ?? DEFAULT_LINKED_TARGET_DELAY_MS) / 1000).toFixed(
                        (action.delayMs ?? DEFAULT_LINKED_TARGET_DELAY_MS) % 1000 ? 1 : 0,
                      )}s
                    </span>
                  )}
                <Play size={11} fill="currentColor" />
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}
