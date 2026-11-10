import { evaluateServerAccess, type ServerAuth } from '../utils/serverAccess'

/**
 * One authorization pass per /api/** request.
 *
 * `auth.ts` runs first and answers "is this a valid hub token for this appId",
 * which is identity, not permission. This middleware answers "may this caller
 * use this route" and is default-deny, so a handler that forgets a check is
 * still covered. The previous version declared an empty permission map and
 * looped over it — a policy that could not fail.
 */
export default defineEventHandler((event) => {
  const decision = evaluateServerAccess(
    event.path,
    event.method || 'GET',
    (event.context.auth as ServerAuth | undefined) ?? null
  )

  if (!decision.allowed) {
    throw createError({
      statusCode: decision.statusCode,
      statusMessage: decision.statusMessage,
      message: decision.message
    })
  }
})
