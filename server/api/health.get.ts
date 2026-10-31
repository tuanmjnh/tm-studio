export default defineEventHandler(() => {
  return {
    status: 'ok',
    app: 'tm-studio',
    time: new Date().toISOString()
  }
})
