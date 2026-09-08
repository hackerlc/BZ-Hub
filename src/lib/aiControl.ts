export const AI_CONTROL_VERSION = 1;

export interface QueuedAiControlRequest {
  requestPath: string;
  contents: string;
}

export interface AiControlEnvelope {
  version: 1;
  requestId: string;
  token: string;
  action: string;
  params: Record<string, unknown>;
}

export interface AiControlResponse {
  version: 1;
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createAiControlToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseAiControlEnvelope(contents: string): AiControlEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`AI 请求不是有效的 JSON：${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) throw new Error("AI 请求格式不正确");
  if (parsed.version !== AI_CONTROL_VERSION) throw new Error(`不支持 AI 控制协议版本 ${String(parsed.version)}`);
  if (typeof parsed.requestId !== "string" || !parsed.requestId.trim()) throw new Error("AI 请求缺少 requestId");
  if (typeof parsed.token !== "string" || !parsed.token) throw new Error("AI 请求缺少本地授权令牌");
  if (typeof parsed.action !== "string" || !parsed.action.trim()) throw new Error("AI 请求缺少 action");
  if (parsed.params !== undefined && !isRecord(parsed.params)) throw new Error("AI 请求的 params 必须是对象");

  return {
    version: AI_CONTROL_VERSION,
    requestId: parsed.requestId,
    token: parsed.token,
    action: parsed.action,
    params: parsed.params ?? {},
  };
}

export function aiControlSuccess(requestId: string, data: unknown): AiControlResponse {
  return { version: AI_CONTROL_VERSION, requestId, ok: true, data };
}

export function aiControlFailure(requestId: string, error: unknown): AiControlResponse {
  return {
    version: AI_CONTROL_VERSION,
    requestId,
    ok: false,
    error: error instanceof Error ? error.message : String(error || "AI 控制请求失败"),
  };
}

export function optionalString(
  params: Record<string, unknown>,
  key: string,
  maximumLength = 2_000,
): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} 必须是文本`);
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : undefined;
}

export function requiredString(
  params: Record<string, unknown>,
  key: string,
  maximumLength = 2_000,
): string {
  const value = optionalString(params, key, maximumLength);
  if (!value) throw new Error(`缺少 ${key}`);
  return value;
}

export function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} 必须是 true 或 false`);
  return value;
}

export function optionalInteger(
  params: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return Number(value);
}

export function hasOwn(params: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(params, key);
}
