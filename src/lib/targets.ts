import type {
  DesktopPlatform,
  LaunchAction,
  LaunchItem,
  LaunchKind,
  LaunchTarget,
} from "../types";

export const DEFAULT_LINKED_TARGET_DELAY_MS = 1_000;
export const MAX_LINKED_TARGET_DELAY_MS = 60_000;

const applicationExtensions = [".exe", ".com", ".bat", ".cmd", ".lnk", ".app"];

function findApplicationBoundary(value: string, platform: "windows" | "macos"): number | null {
  const lower = value.toLocaleLowerCase();
  const extensions = platform === "windows"
    ? applicationExtensions.filter((extension) => extension !== ".app")
    : [".app"];
  const matches = extensions.flatMap((extension) => {
    const positions: number[] = [];
    let start = 0;
    while (start < lower.length) {
      const index = lower.indexOf(extension, start);
      if (index < 0) break;
      const end = index + extension.length;
      if (end === lower.length || /\s/.test(lower[end])) positions.push(end);
      start = index + 1;
    }
    return positions;
  });
  return matches.length ? Math.min(...matches) : null;
}

export function splitLegacyApplicationTarget(
  target: LaunchTarget,
  platform: "windows" | "macos",
): LaunchTarget {
  if (target.arguments !== undefined) return target;
  const value = target.value?.trim();
  if (!value) return { value: "", arguments: "" };

  if (value.startsWith('"')) {
    const closingQuote = value.indexOf('"', 1);
    if (closingQuote > 1) {
      return {
        value: value.slice(1, closingQuote),
        arguments: value.slice(closingQuote + 1).trim(),
      };
    }
    return target;
  }

  const boundary = findApplicationBoundary(value, platform);
  if (boundary === null) return target;
  return {
    value: value.slice(0, boundary).trim(),
    arguments: value.slice(boundary).trim(),
  };
}

export function normalizeLaunchTarget(
  target: LaunchTarget | undefined,
  kind: LaunchKind,
  platform: "windows" | "macos",
): LaunchTarget | undefined {
  if (!target || typeof target.value !== "string") return undefined;
  const normalized: LaunchTarget = {
    value: target.value.trim(),
    ...(typeof target.arguments === "string" ? { arguments: target.arguments.trim() } : {}),
  };
  return kind === "application" ? splitLegacyApplicationTarget(normalized, platform) : normalized;
}

function normalizeTargetMap(
  targets: LaunchAction["targets"] | LaunchItem["targets"] | undefined,
  kind: LaunchKind,
): LaunchAction["targets"] {
  return {
    windows: normalizeLaunchTarget(targets?.windows, kind, "windows"),
    macos: normalizeLaunchTarget(targets?.macos, kind, "macos"),
  };
}

export function normalizeLaunchAction(action: LaunchAction): LaunchAction {
  const delay = Number(action.delayMs);
  return {
    ...action,
    targets: normalizeTargetMap(action.targets, action.kind),
    delayMs: Number.isFinite(delay)
      ? Math.min(MAX_LINKED_TARGET_DELAY_MS, Math.max(0, delay))
      : DEFAULT_LINKED_TARGET_DELAY_MS,
  };
}

export function normalizeLaunchItem(item: LaunchItem): LaunchItem {
  return {
    ...item,
    frequent: item.frequent ?? true,
    aliases: Array.isArray(item.aliases)
      ? item.aliases.filter((alias): alias is string => typeof alias === "string").map((alias) => alias.trim()).filter(Boolean)
      : [],
    targets: normalizeTargetMap(item.targets, item.kind),
    linkedTargets: Array.isArray(item.linkedTargets)
      ? item.linkedTargets.map(normalizeLaunchAction)
      : [],
  };
}

export function inferLaunchKind(path: string, selectedDirectory: boolean, fallback: LaunchKind): LaunchKind {
  if (selectedDirectory) return fallback === "folder" ? "folder" : "project";
  const lower = path.toLocaleLowerCase();
  return applicationExtensions.some((extension) => lower.endsWith(extension)) ? "application" : "file";
}

export function nameFromTargetPath(path: string, kind: LaunchKind): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const leaf = normalized.split(/[\\/]/).pop()?.trim() ?? "";
  if (!leaf) return "";
  return kind === "application"
    ? leaf.replace(/\.(exe|com|bat|cmd|lnk|app)$/i, "")
    : leaf;
}

export function fallbackIconForKind(kind: LaunchKind): string {
  if (kind === "application") return "◈";
  if (kind === "project") return "◆";
  if (kind === "folder") return "▣";
  if (kind === "file") return "▤";
  return "◎";
}

export function targetSummaryValue(target: LaunchTarget | undefined): string {
  if (!target) return "";
  return [target.value.trim(), target.arguments?.trim()].filter(Boolean).join(" ");
}

export function currentDesktopPlatform(platform: DesktopPlatform): "windows" | "macos" | null {
  return platform === "windows" || platform === "macos" ? platform : null;
}
