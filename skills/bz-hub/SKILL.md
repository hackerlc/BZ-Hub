---
name: bz-hub
description: Control the local BZ Hub desktop app through its authorized MCP bridge to search or open preconfigured launch entries and to list, create, update, complete, or delete BZ Hub calendar items. Use when the user asks to operate BZ Hub from conversation, such as 打开入口, 添加日程, 修改提醒, or 完成事项. Do not use for general calendar advice, operating-system commands, or changing BZ Hub source code.
---

# BZ Hub Control

Operate BZ Hub only through the tools exposed by the `bz-hub` MCP server.

## Safety boundary

- Never edit BZ Hub source code, local storage, export files, or Supabase rows to perform an app operation.
- Never use a shell command, raw executable path, or URL as a substitute for `open_entry`.
- Open only an entry or child action returned by `search_entries`.
- Treat IDs as opaque and copy them exactly from tool results.
- If an entry name has multiple plausible matches, show the short match list and ask which one the user means.
- Delete a calendar item only when the user clearly identified that item and asked to delete it. Search/list first when identity is uncertain.

## Entry workflow

1. Call `search_entries` with the user's words, including aliases or pinyin when useful.
2. For one clear match, call `open_entry` with its `entryId`.
3. To open one child of a combined entry, also pass the returned `actionId`.
4. Report partial launch errors exactly; do not retry a failed launch repeatedly unless the user asks.

## Calendar workflow

1. Use `get_status` when resolving relative dates such as 今天, 明天, or 下周; use its local `today` value.
2. Use `list_calendar_entries` before changing, completing, or deleting an existing item unless the user supplied its exact ID from the immediately preceding result.
3. Send dates as `YYYY-MM-DD` and times as 24-hour `HH:mm`.
4. Default new items to `normal`; use `important` only when the user says it is important or the meaning is unmistakable.
5. Omit an unknown time instead of inventing one. Preserve unspecified fields during updates.
6. After every mutation, briefly confirm the title and effective date/time returned by BZ Hub.

Read [references/control-api.md](references/control-api.md) only when tool selection or a field's meaning is unclear.
