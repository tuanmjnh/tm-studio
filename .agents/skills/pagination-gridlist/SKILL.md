---
name: pagination-gridlist
description: Reusable cursor pagination and GridList component patterns for list views and tables across frontend and backend.
---

# Pagination & GridList

Reusable cursor pagination + the `GridListIndex` component for list views in this project.

## Cursor pagination (backend)

- Reusable helper `cursorPage(table, cursor, limit)` lives in `electron/tools/sqlite.cjs`
  (exported). Returns `{ items, nextCursor, hasMore }`, ordered `created_at DESC, rowid DESC`,
  fetches `LIMIT+1` to compute `hasMore`. Cursor = `{ ts, rowid }` of the last item.
- Wrap it for each table, e.g. `listHistoryCursor: (cursor, limit=30) => cursorPage('youtube_history', cursor, limit)`.
- Expose over IPC in `youtube.controller.cjs`, register the method in `electron/preload.cjs`,
  and type it in `types/electron.ts` (`CursorPage<T>`).

## Cursor pagination (frontend)

- Reusable composable `useCursorPagination<T>({ fetch, limit })` in `app/composables/useCursorPagination.ts`.
  Returns `{ items, nextCursor, hasMore, loading, refresh, loadMore, reset }`.
- `fetch` must return `Promise<CursorPage<T> | undefined | null>`.
- The `fetch` fn must call the preload API with a SINGLE payload object, e.g.
  `(cursor, limit) => taskManager.api!.listHistoryCursor({ cursor, limit })`
  (preload forwards only the first argument to IPC).

## GridList usage

Component: `app/components/gridList/Index.vue` → auto-imported as `<GridListIndex>`.

- Prefer `GridListIndex` for list views. Provide:
  - `:items`, `:columns` (`{ key, label, slot? }[]`), `item-key="id"`.
  - `:loading`, `:can-load-more="hasMore"`, `storage-key="unique-key"`.
  - `@load-more` (infinite scroll) and `@refresh`.
- Always provide a `#mobile-content="{ item }"` slot for mobile card layouts.
- Custom columns via `<template #<key>="{ item }">`; row actions via `<template #actions="{ item }">`.
- Wrap it in a fixed-height container (e.g. `class="h-[60vh]"`) so its internal
  `UScrollArea`/infinite scroll works.
- The backend must NOT leak the internal cursor column: `cursorPage` strips `__r` before returning.

## Checklist

- [ ] Backend exposes a cursor list endpoint via `cursorPage()`.
- [ ] Frontend uses `useCursorPagination` for state.
- [ ] Render with `GridListIndex` + `#mobile-content` slot.
- [ ] Preload call passes a single `{ cursor, limit }` object.
