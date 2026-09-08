import type {
  DesktopPlatform,
  LaunchAction,
  LaunchItem,
  LaunchKind,
} from "../types";
import { isTauriRuntime } from "./platform";
import { DEFAULT_LINKED_TARGET_DELAY_MS, targetSummaryValue } from "./targets";

export interface BatchLaunchResult {
  launched: string[];
  errors: Array<{ name: string; message: string }>;
}

export function isSupportedWebTarget(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:";
  } catch {
    return false;
  }
}

export function primaryActionFor(item: LaunchItem): LaunchAction {
  return {
    id: `primary-${item.id}`,
    name: item.name,
    icon: item.icon,
    kind: item.kind,
    scope: item.scope,
    url: item.url,
    targets: item.targets,
    includeInBatch: true,
    delayMs: 0,
  };
}

export function launchActionsFor(item: LaunchItem): LaunchAction[] {
  return [primaryActionFor(item), ...(item.linkedTargets ?? [])];
}

export function canLaunchAction(action: LaunchAction, platform: DesktopPlatform): boolean {
  if (action.scope !== "all" && action.scope !== platform) return false;
  if (action.kind === "url") return Boolean(action.url?.trim());
  if (platform !== "windows" && platform !== "macos") return false;
  return Boolean(action.targets[platform]?.value.trim());
}

export function canLaunchOnPlatform(item: LaunchItem, platform: DesktopPlatform): boolean {
  return launchActionsFor(item).some((action) => canLaunchAction(action, platform));
}

export function actionTargetSummary(action: LaunchAction, platform: DesktopPlatform): string {
  if (action.kind === "url") return action.url ?? "未设置网址";
  if (platform === "windows" || platform === "macos") {
    return targetSummaryValue(action.targets[platform]) || `尚未设置 ${platform === "windows" ? "Windows" : "macOS"} 目标`;
  }
  return "仅可在桌面应用中打开";
}

export function targetSummary(item: LaunchItem, platform: DesktopPlatform): string {
  const linkedCount = item.linkedTargets?.length ?? 0;
  if (linkedCount > 0) return `组合启动 · ${linkedCount + 1} 个目标`;
  return actionTargetSummary(primaryActionFor(item), platform);
}

async function invokeTarget(kind: LaunchKind, target: string, argumentsValue?: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("launch_target", { kind, target, arguments: argumentsValue ?? null });
    return;
  }

  if (kind === "url") {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }

  throw new Error("浏览器预览不能打开本机应用或文件");
}

export async function launchAction(action: LaunchAction, platform: DesktopPlatform): Promise<void> {
  const configuredTarget = platform === "windows" || platform === "macos"
    ? action.targets[platform]
    : undefined;
  const target = action.kind === "url" ? action.url?.trim() : configuredTarget?.value.trim();

  if (!target || !canLaunchAction(action, platform)) {
    throw new Error("当前系统尚未配置可打开的目标");
  }

  if (action.kind === "url" && !isSupportedWebTarget(target)) {
    throw new Error("网页地址仅支持 http://、https:// 或 file:///");
  }

  await invokeTarget(action.kind, target, configuredTarget?.arguments?.trim());
}

export async function launchItem(item: LaunchItem, platform: DesktopPlatform): Promise<BatchLaunchResult> {
  const actions = launchActionsFor(item).filter((action, index) =>
    (index === 0 || action.includeInBatch !== false) && canLaunchAction(action, platform),
  );
  if (!actions.length) throw new Error("当前系统尚未配置可打开的目标");

  const result: BatchLaunchResult = { launched: [], errors: [] };
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (index > 0) {
      const delayMs = Number.isFinite(action.delayMs)
        ? Math.max(0, action.delayMs ?? DEFAULT_LINKED_TARGET_DELAY_MS)
        : DEFAULT_LINKED_TARGET_DELAY_MS;
      if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    try {
      await launchAction(action, platform);
      result.launched.push(action.name);
    } catch (error) {
      result.errors.push({
        name: action.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!result.launched.length && result.errors.length) {
    throw new Error(result.errors.map((entry) => `${entry.name}：${entry.message}`).join("；"));
  }
  return result;
}
