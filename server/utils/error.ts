import { createError } from 'h3'

/**
 * Handle API error and throw standard H3Error
 */
export function handleApiError(error: unknown, statusMessage = 'error.server_error') {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number') {
    throw error
  }

  let message = 'error.server_error'
  if (error instanceof Error) {
    message = error.message
  } else if (error && typeof error === 'object') {
    const errObj = error as { error?: { message?: string }, message?: string }
    if (errObj.error?.message) {
      message = errObj.error.message
    } else if (errObj.message) {
      message = errObj.message
    }
  } else if (error) {
    message = String(error)
  }

  throw createError({
    statusCode: 500,
    statusMessage,
    message
  })
}
