---
name: error-handling
description: API error convention and i18n statusMessage handling across backend createError and frontend getErrorMessage resolvers.
---

# API error convention (i18n statusMessage)

Frontend-backend error convention for this project.

## Convention

- Backend `createError` MUST send:
  - `statusMessage` = i18n key (e.g. `error.invalidCredentials`)
  - `message` = human-readable English text (logs / fallback)
  Example: `throw createError({ statusCode: 401, statusMessage: 'error.invalidCredentials', message: 'Invalid email/username or password' })`
- NEVER put free-form text in `statusMessage` — it is treated as an i18n key by the frontend.
- Frontend resolves the display string with the shared util and falls back in this order:
  1. `statusMessage` translated via `t()` (if a translation exists);
  2. raw `message` text;
  3. status-code-based default key via `getErrorKey`.

## Shared util

`app/shared/utils/errors.ts` exports:
- `getErrorMessage(err, t)` — main resolver; `t` is `(key: string) => string` (e.g. `key => t(key)`).
- `getErrorKey(err)` — status-code → default i18n key (`error.network`, `error.invalidCredentials`, `error.forbidden`, `error.notFound`, `error.conflict`, `error.validation`, `error.tooManyAttempts`, `error.serverError`, `error.unexpected`).
- `getApiErrorStatus(err)` — reads `statusCode` or `data.statusCode`.

Usage in a page (must be EXPLICITLY imported — `app/shared/utils/` is not auto-imported):

```ts
import { getErrorMessage } from '~/shared/utils/errors'

catch (err: unknown) {
  toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
}
```

## i18n keys

- All error keys live under the top-level `error` namespace in `i18n/locales/en.json` AND `i18n/locales/vi.json`.
- Existing keys: `error.unauthorized`, `error.forbidden`, `error.notFound`, `error.invalidRequest`, `error.validation`, `error.conflict`, `error.tooManyAttempts`, `error.serverError`, `error.network`, `error.unexpected`, `error.invalidCredentials`, `error.invalidToken`, `error.tokenMissing`, `error.emailExists`, `error.usernameExists`, `error.userNotFound`, `error.systemRoleProtected`, `error.routeIdRequired`, `error.routeNotFound`, `error.itemsRequired`, `error.sessionIdRequired`, `error.messagesRequired`, `error.aiNotConfigured`, `error.aiFailed`, `error.chatNoPermission`, `error.notRoot`.
- Adding a new `statusMessage` key requires updating BOTH locale files.

## Checklist

- [ ] Backend `statusMessage` is an i18n key, `message` is human text.
- [ ] New i18n keys added to both `en.json` and `vi.json` under `error.*`.
- [ ] Frontend uses `getErrorMessage(err, key => t(key))` (imported from `~/shared/utils/errors`).
- [ ] `pnpm typecheck` + targeted eslint pass.
