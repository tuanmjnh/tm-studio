export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const err = error as Error & { statusCode?: number }
    console.error('[Server Error]', {
      path: event?.path,
      method: event?.method,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 6).join('\n'),
      statusCode: err.statusCode
    })
  })
})
