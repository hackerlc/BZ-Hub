# BZ Hub control tools

All tools talk to the running BZ Hub application. If it is closed, the bridge starts it hidden. The user must first enable **设置 → 通用 → AI 控制** in BZ Hub.

## Entry tools

- `search_entries`: fuzzy-searches names, aliases, descriptions, pinyin initials, and combined-entry child names. Returns safe metadata and opaque IDs, never local target paths.
- `open_entry`: opens the matching configured entry. With only `entryId`, it follows the entry's normal combined-launch switches and delays. With `actionId`, it opens just that primary or child action.

## Calendar tools

- `list_calendar_entries`: lists active items in an inclusive date range. Without a range, it returns up to 100 items from today through the following 365 days.
- `create_calendar_entry`: requires `title` and `date`; accepts `time`, `note`, `importance`, and `linkedItemId`.
- `update_calendar_entry`: requires `entryId` and changes only supplied fields. Send `null` for `time`, `note`, or `linkedItemId` to clear it.
- `set_calendar_entry_completed`: requires `entryId` and `completed`.
- `delete_calendar_entry`: soft-deletes one item so BZ Hub's existing sync can propagate the deletion.

`importance` is `normal` or `important`. Dates use `YYYY-MM-DD`; times use 24-hour `HH:mm`.

## Errors

Surface the returned error message to the user. Common causes are: AI control disabled, BZ Hub not installed at the recorded location, an ambiguous/stale ID, a target unavailable on this computer, or an invalid date/time.
