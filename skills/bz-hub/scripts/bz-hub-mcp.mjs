#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const SERVER_NAME = "bz-hub";
const SERVER_VERSION = "0.1.0";
const CONTROL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 30_000;

const tools = [
  {
    name: "get_status",
    description: "Read BZ Hub availability, local date, entry counts, and the next important calendar item.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_entries",
    description: "Fuzzy-search launch entries by name, alias, description, pinyin initials, or combined child name. Returns safe IDs and no target paths.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "Words used to find the entry." },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "open_entry",
    description: "Open one preconfigured BZ Hub entry, or one returned child action. Never accepts a raw path, URL, or command.",
    inputSchema: {
      type: "object",
      properties: {
        entryId: { type: "string", minLength: 1, description: "Opaque ID returned by search_entries." },
        actionId: { type: "string", minLength: 1, description: "Optional primary or child action ID returned by search_entries." },
      },
      required: ["entryId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_calendar_entries",
    description: "List active BZ Hub calendar items in an inclusive date range, optionally filtered by importance or completion.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Inclusive start date; defaults to today." },
        to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Inclusive end date; defaults to 365 days after from." },
        importance: { type: "string", enum: ["normal", "important"] },
        completed: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_calendar_entry",
    description: "Create one BZ Hub calendar item through the application so normal local save and cloud sync apply.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 120 },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        time: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
        note: { type: "string", maxLength: 2000 },
        importance: { type: "string", enum: ["normal", "important"], default: "normal" },
        linkedItemId: { type: "string", minLength: 1, description: "Optional entry ID to link to this calendar item." },
      },
      required: ["title", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "update_calendar_entry",
    description: "Update supplied fields on one existing BZ Hub calendar item; omitted fields remain unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        entryId: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1, maxLength: 120 },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        time: { anyOf: [{ type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }, { type: "null" }] },
        note: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
        importance: { type: "string", enum: ["normal", "important"] },
        linkedItemId: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
      },
      required: ["entryId"],
      additionalProperties: false,
    },
  },
  {
    name: "set_calendar_entry_completed",
    description: "Mark one existing BZ Hub calendar item completed or not completed.",
    inputSchema: {
      type: "object",
      properties: {
        entryId: { type: "string", minLength: 1 },
        completed: { type: "boolean" },
      },
      required: ["entryId", "completed"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_calendar_entry",
    description: "Soft-delete one specifically identified BZ Hub calendar item. This is destructive and should follow clear user intent.",
    inputSchema: {
      type: "object",
      properties: { entryId: { type: "string", minLength: 1 } },
      required: ["entryId"],
      additionalProperties: false,
    },
  },
];

function configPath() {
  if (process.env.BZ_HUB_AI_CONFIG) return process.env.BZ_HUB_AI_CONFIG;
  if (platform() === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("找不到 Windows APPDATA，无法定位 BZ Hub AI 控制配置");
    return join(appData, "com.bzhub.launcher", "bz-hub-ai-control.json");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "com.bzhub.launcher", "bz-hub-ai-control.json");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "com.bzhub.launcher", "bz-hub-ai-control.json");
}

async function loadConfig() {
  const path = configPath();
  let config;
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("尚未找到 BZ Hub AI 控制配置。请先打开 BZ Hub，在“设置 → 通用 → AI 控制”中启用它");
    }
    throw new Error(`无法读取 BZ Hub AI 控制配置：${error instanceof Error ? error.message : String(error)}`);
  }
  if (config?.version !== CONTROL_VERSION) throw new Error("BZ Hub AI 控制配置版本不兼容");
  if (config.enabled !== true) throw new Error("BZ Hub 的 AI 控制尚未开启");
  if (typeof config.token !== "string" || config.token.length < 32) throw new Error("BZ Hub AI 控制令牌无效");
  if (typeof config.executable !== "string" || !config.executable || !existsSync(config.executable)) {
    throw new Error("BZ Hub 程序位置已经改变。请手动打开一次新版 BZ Hub，让它刷新 AI 控制配置");
  }
  return config;
}

function responsePathFor(requestPath) {
  return requestPath.replace(/\.request\.json$/, ".response.json");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startApplication(executable, requestPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ["--bz-hub-control", requestPath], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

async function callApplication(action, params) {
  const config = await loadConfig();
  const requestId = randomUUID();
  const requestPath = join(tmpdir(), `bz-hub-ai-${requestId}.request.json`);
  const responsePath = responsePathFor(requestPath);
  const request = {
    version: CONTROL_VERSION,
    requestId,
    token: config.token,
    action,
    params: params && typeof params === "object" && !Array.isArray(params) ? params : {},
  };

  await writeFile(requestPath, JSON.stringify(request), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await startApplication(config.executable, requestPath);
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = JSON.parse(await readFile(responsePath, "utf8"));
        if (response?.requestId !== requestId) throw new Error("BZ Hub 返回了不匹配的请求标识");
        if (response?.ok !== true) throw new Error(response?.error || "BZ Hub 未能完成请求");
        return response.data;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await wait(75);
    }
    throw new Error("等待 BZ Hub 响应超时。请确认应用可以启动，并且 AI 控制仍处于开启状态");
  } finally {
    await Promise.all([
      unlink(requestPath).catch(() => undefined),
      unlink(responsePath).catch(() => undefined),
    ]);
  }
}

function resultContent(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : { structuredContent: value }),
  };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: "Operate BZ Hub only with returned opaque IDs. Search before opening an entry and list before changing an uncertain calendar item.",
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (method === "tools/call") {
    const tool = tools.find((candidate) => candidate.name === params?.name);
    if (!tool) {
      return { jsonrpc: "2.0", id, result: resultContent(`未知的 BZ Hub 工具：${String(params?.name)}`, true) };
    }
    try {
      const data = await callApplication(tool.name, params?.arguments ?? {});
      return { jsonrpc: "2.0", id, result: resultContent(data) };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: resultContent(error instanceof Error ? error.message : String(error), true),
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${String(method)}` } };
}

function selfTest() {
  const names = tools.map((tool) => tool.name);
  if (new Set(names).size !== names.length) throw new Error("工具名称重复");
  if (!configPath().endsWith("bz-hub-ai-control.json")) throw new Error("配置路径无效");
  if (responsePathFor("bz-hub-ai-test.request.json") !== "bz-hub-ai-test.response.json") {
    throw new Error("响应文件名转换失败");
  }
  process.stdout.write(`BZ Hub MCP self-test passed (${tools.length} tools)\n`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    void (async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        return;
      }
      if (message.id === undefined) return;
      const response = await handleRequest(message);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    })().catch((error) => {
      process.stderr.write(`BZ Hub MCP error: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    });
  });
}
