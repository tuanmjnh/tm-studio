/**
 * Error resolution lives in `@tuanmjnh/tm-core` so a server route, a CLI or a
 * test can resolve one without a Vue app. This file keeps the import path the
 * ~100 call sites already use.
 */
export {
  type ApiErrorPayload,
  type Translate,
  getApiErrorStatus,
  getErrorKey,
  getErrorMessage,
  getPresetErrorMessage,
  isHubConnectionError
} from '@tuanmjnh/tm-core'
