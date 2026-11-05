export type DocsRoadmapStatus = 'shipped' | 'in_progress' | 'planned'

export interface DocsArchitectureCard {
  icon: string
  iconClass: string
  hoverClass: string
  title: string
  desc: string
}

export interface DocsRoadmapItem {
  phase: string
  status: DocsRoadmapStatus
  statusLabel: string
  title: string
  desc: string
}

export interface DocsRoadmapSection {
  title: string
  description: string
  updatedLabel: string
  items: DocsRoadmapItem[]
}

export interface DocsSdkInstallCommand {
  label: string
  code: string
}

export interface DocsSdkSection {
  title: string
  description: string
  install: string
  installHint: string
  usage: string
  copyLabel: string
  copiedLabel: string
  githubLabel: string
  githubUrl: string
  installCommands: DocsSdkInstallCommand[]
  usageCode: string
}

export interface DocsApiSection {
  title: string
  prefixLabel: string
  headers: { module: string, method: string, endpoint: string, description: string }
}

export interface DocsApiReference {
  module: string
  method: string
  path: string
  desc: string
}

export interface DocsSetupStep {
  title: string
  desc: string
  code?: string
  lang?: string
}

export interface DocsSetupSection {
  title: string
  description: string
  steps: DocsSetupStep[]
}

export interface DocsContentLocale {
  architecture: DocsArchitectureCard[]
  roadmap: DocsRoadmapSection
  setupGuide?: DocsSetupSection
  sdk: DocsSdkSection
  api: DocsApiSection
  apis: DocsApiReference[]
}

export interface HubDocsContent {
  version: number
  updatedAt: string
  en: DocsContentLocale
  vi: DocsContentLocale
}
