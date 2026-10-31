import { z } from 'zod'

export const BrowserEngineSchema = z.enum([
  'chromium',
  'firefox',
  'camoufox',
  'donut',
  'browser_oxide',
  'custom'
])
export type BrowserEngine = z.infer<typeof BrowserEngineSchema>

export const BrowserStatusSchema = z.enum(['available', 'missing'])
export type BrowserStatus = z.infer<typeof BrowserStatusSchema>

export const BrowserCapabilitiesSchema = z.object({
  cdp: z.boolean(),
  extensions: z.boolean(),
  customArgs: z.boolean(),
  incognito: z.boolean(),
  headless: z.boolean()
})
export type BrowserCapabilities = z.infer<typeof BrowserCapabilitiesSchema>

export const BrowserItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  engine: BrowserEngineSchema,
  executablePath: z.string().min(1),
  version: z.string(),
  isDefault: z.boolean(),
  isCustom: z.boolean(),
  detectedAt: z.number().nullable().optional(),
  status: BrowserStatusSchema
})
export type BrowserItem = z.infer<typeof BrowserItemSchema>

export const AddCustomBrowserInputSchema = z.object({
  name: z.string().min(1, 'Browser name is required'),
  engine: BrowserEngineSchema,
  executablePath: z.string().min(1, 'Executable path is required')
})
export type AddCustomBrowserInput = z.infer<typeof AddCustomBrowserInputSchema>

export const TestExecutableInputSchema = z.object({
  executablePath: z.string().min(1, 'Executable path is required'),
  engine: BrowserEngineSchema.optional()
})
export type TestExecutableInput = z.infer<typeof TestExecutableInputSchema>

export const TestExecutableResultSchema = z.object({
  valid: z.boolean(),
  version: z.string().optional(),
  engine: BrowserEngineSchema.optional(),
  error: z.string().optional()
})
export type TestExecutableResult = z.infer<typeof TestExecutableResultSchema>
