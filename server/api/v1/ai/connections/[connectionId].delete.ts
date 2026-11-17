import { getRouterParam } from 'h3'
import { tmStudioAIConfigStore } from '../../../../utils/aiConfigMongo'

export default defineEventHandler(async (event) => {
  const ownerId = event.context.auth?.userId
  if (!ownerId) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const connectionId = getRouterParam(event, 'connectionId')
  if (!connectionId) throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'connectionId is required' })
  await tmStudioAIConfigStore(ownerId).removeConnection(connectionId)
  return { success: true }
})
