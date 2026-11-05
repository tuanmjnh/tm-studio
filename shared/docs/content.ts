// =============================================================================
//  Docs reference content — SINGLE SOURCE OF TRUTH for the /admin-system (docs)
//  page across the TM platform (tm-hub + satellites tm-tools / tm-trading / tm-studio).
// =============================================================================

import systemDocsData from '../../docs/content/system_docs.json'
import type { HubDocsContent } from '#shared/types/docs'

export * from '#shared/types/docs'

export const HUB_DOCS_VERSION = systemDocsData.version
export const HUB_DOCS_UPDATED_AT = systemDocsData.updatedAt
export const HUB_DOCS_CONTENT: HubDocsContent = systemDocsData as unknown as HubDocsContent

/** Replace the placeholders in the SDK sample code. */
export function docsUsageCodeFor(usageCode: string, appId: string, hubEnvVar: string): string {
  return usageCode
    .replace(/\{HUB_URL_ENV\}/g, hubEnvVar)
    .replace("{ appId: '{appId}' }", `appId: '${appId}'`)
}

/** Replace the `{app}` placeholder inside the SDK description sentence. */
export function docsSdkDescriptionFor(description: string, appName: string): string {
  return description.replace('{app}', appName)
}
