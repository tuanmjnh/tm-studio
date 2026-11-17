import { tmStudioAIConfigStore, tmStudioSafeConnection } from '../../../../utils/aiConfigMongo'

export default defineEventHandler(async (event) => {
  const ownerId = event.context.auth?.userId
  if (!ownerId) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const rows = await tmStudioAIConfigStore(ownerId).listConnections()
  return { success: true, data: { connections: rows.map(tmStudioSafeConnection) } }
})
