import { pinyin } from "pinyin-pro";
import type { LaunchItem } from "../types";
import { targetSummaryValue } from "./targets";

interface SearchCacheEntry {
  signature: string;
  tokens: string[];
}

const searchCache = new Map<string, SearchCacheEntry>();

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_\-./\\]+/g, "");
}

function variants(value: string): string[] {
  const normalized = normalize(value);
  if (!value.trim()) return [];
  const fullPinyin = normalize(pinyin(value, { toneType: "none", type: "array" }).join(""));
  const initials = normalize(pinyin(value, {
    pattern: "first",
    toneType: "none",
    type: "array",
  }).join(""));
  return [...new Set([normalized, fullPinyin, initials].filter(Boolean))];
}

function tokensFor(item: LaunchItem): string[] {
  const linkedText = (item.linkedTargets ?? []).flatMap((action) => [
    action.name,
    action.url ?? "",
    targetSummaryValue(action.targets.windows),
    targetSummaryValue(action.targets.macos),
  ]);
  const fields = [
    item.name,
    item.description,
    ...(item.aliases ?? []),
    item.url ?? "",
    targetSummaryValue(item.targets.windows),
    targetSummaryValue(item.targets.macos),
    ...linkedText,
  ];
  const signature = JSON.stringify([item.updatedAt, fields]);
  const cached = searchCache.get(item.id);
  if (cached?.signature === signature) return cached.tokens;

  const tokens = [...new Set(fields.flatMap(variants))];
  searchCache.set(item.id, { signature, tokens });
  return tokens;
}

function fuzzyTokenScore(token: string, query: string): number | null {
  if (token === query) return 1_000;
  if (token.startsWith(query)) return 800 - Math.min(200, token.length - query.length);
  const directIndex = token.indexOf(query);
  if (directIndex >= 0) return 600 - Math.min(200, directIndex * 4);
  if (query.length < 2) return null;

  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let index = 0; index < token.length && queryIndex < query.length; index += 1) {
    if (token[index] !== query[queryIndex]) continue;
    if (firstMatch < 0) firstMatch = index;
    lastMatch = index;
    queryIndex += 1;
  }
  if (queryIndex !== query.length) return null;
  const span = lastMatch - firstMatch + 1;
  return 350 - Math.min(250, (span - query.length) * 8 + firstMatch * 3);
}

export function launchItemSearchScore(item: LaunchItem, rawQuery: string): number | null {
  const query = normalize(rawQuery);
  if (!query) return 0;
  let best: number | null = null;
  for (const token of tokensFor(item)) {
    const score = fuzzyTokenScore(token, query);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}
