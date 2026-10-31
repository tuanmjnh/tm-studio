import { z } from 'zod'

export const StorageUsageSchema = z.object({
  databaseBytes: z.number(),
  profilesBytes: z.number(),
  logsBytes: z.number(),
  screenshotsBytes: z.number(),
  tempBytes: z.number(),
  totalBytes: z.number()
})
export type StorageUsage = z.infer<typeof StorageUsageSchema>

export const SystemInfoResponseSchema = z.object({
  version: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  chromeVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  userDataPath: z.string(),
  storageUsage: StorageUsageSchema
})
export type SystemInfoResponse = z.infer<typeof SystemInfoResponseSchema>

export const OpenDirectoryInputSchema = z.object({
  pathType: z.enum(['userData', 'profiles', 'logs', 'screenshots', 'backups', 'database', 'temp']),
  subPath: z.string().optional()
})
export type OpenDirectoryInput = z.infer<typeof OpenDirectoryInputSchema>
