import type { DesktopPlatform } from "../types";

export function getPlatform(): DesktopPlatform {
  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

  if (source.includes("mac")) return "macos";
  if (source.includes("win")) return "windows";
  if (source.includes("linux")) return "linux";
  return "web";
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function platformLabel(platform: DesktopPlatform): string {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  if (platform === "linux") return "Linux";
  return "浏览器预览";
}

