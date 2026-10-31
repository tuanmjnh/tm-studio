export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error: any, { event }) => {
    console.error('[Server Error]', {
      path: event?.path,
      method: event?.method,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 6).join('\n'),
      statusCode: error.statusCode
    })
  })
})
