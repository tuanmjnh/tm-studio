import type { ApiResponse } from '~~/shared/contracts/common'
import type { SystemInfoResponse, OpenDirectoryInput, StorageUsage } from '~~/shared/contracts/system.ipc'
import type { EventBusContracts } from '~~/shared/contracts/events'
import type { HubDeviceInfo } from '~~/shared/types/device'

export interface FileStat {
  name: string
  fullPath: string
  isFile: boolean
  isDirectory: boolean
  size: number
  atime: Date
  mtime: Date
  ctime: Date
  birthtime: Date
}

export interface FileNode extends FileStat {
  type: 'file' | 'folder'
  children?: FileNode[]
}

export interface FileOptions {
  extensions?: string[]
  exclude?: string[]
  depth?: number
  isSlashPath?: boolean
}

export type DialogFileFilter = { name: string, extensions: string[] }

export interface DialogArgs {
  title?: string
  filters?: DialogFileFilter[]
  defaultPath?: string
  sync?: boolean
  multiSelections?: boolean
  showHiddenFiles?: boolean
  createDirectory?: boolean
  treatPackageAsDirectory?: boolean
  showOverwriteConfirmation?: boolean
  dontAddToRecent?: boolean
}

export interface DialogNamespace {
  openFile(args?: DialogArgs): Promise<string[] | null>
  openFolder(args?: DialogArgs): Promise<string[] | null>
  saveFile(args?: DialogArgs): Promise<string | null>
}

export interface FileManagerNamespace {
  read(filePath: string, encoding?: string): Promise<string>
  write(args: { filePath: string, data: string, encoding?: string }): Promise<void>
  append(args: { filePath: string, data: string, encoding?: string }): Promise<boolean>
  exists(filePath: string): Promise<boolean>
  delete(filePath: string): Promise<boolean>
  readJSON(filePath: string): Promise<unknown | null>
  writeJSON(args: { filePath: string, obj: unknown, space?: number }): Promise<boolean>
  createFolder(dirPath: string): Promise<boolean>
  rename(args: { oldPath: string, newPath: string }): Promise<boolean>
  copyFile(args: { src: string, dest: string }): Promise<boolean>
  copyFolder(args: { src: string, dest: string }): Promise<boolean>
  getTree(args: { dirPath: string, options?: FileOptions }): Promise<FileNode | null>
  listFlat(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listFiles(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listFolders(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listAll(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listFileNames(args: { dirPath: string, options?: FileOptions }): Promise<string[]>
  listFolderNames(args: { dirPath: string, options?: FileOptions }): Promise<string[]>
  listAllNames(args: { dirPath: string, options?: FileOptions }): Promise<string[]>
  readAsync(filePath: string, encoding?: string): Promise<string>
  writeAsync(args: { filePath: string, data: string, encoding?: string }): Promise<void>
  appendAsync(args: { filePath: string, data: string, encoding?: string }): Promise<boolean>
  existsAsync(filePath: string): Promise<boolean>
  deleteAsync(filePath: string): Promise<boolean>
  readJSONAsync(filePath: string): Promise<unknown | null>
  writeJSONAsync(args: { filePath: string, obj: unknown, space?: number }): Promise<boolean>
  createFolderAsync(dirPath: string): Promise<boolean>
  renameAsync(args: { oldPath: string, newPath: string }): Promise<boolean>
  copyFileAsync(args: { src: string, dest: string }): Promise<boolean>
  copyFolderAsync(args: { src: string, dest: string }): Promise<boolean>
  getTreeAsync(args: { dirPath: string, options?: FileOptions }): Promise<FileNode | null>
  listFlatAsync(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listFilesAsync(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listFoldersAsync(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listAllAsync(args: { dirPath: string, options?: FileOptions }): Promise<FileNode[]>
  listFileNamesAsync(args: { dirPath: string, options?: FileOptions }): Promise<string[]>
  listFolderNamesAsync(args: { dirPath: string, options?: FileOptions }): Promise<string[]>
  listAllNamesAsync(args: { dirPath: string, options?: FileOptions }): Promise<string[]>
  imageToDataUrl(imagePath: string): Promise<string | null>
}

export interface AppUpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  updateInfo?: {
    version: string
    releaseDate?: string
    releaseNotes?: string
  } | null
  progress: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }
  error?: string | null
}

export interface AppUpdaterNamespace {
  getStatus(): Promise<{ status: boolean, data: AppUpdateStatus }>
  checkForUpdates(): Promise<{ status: boolean, data?: unknown, message?: string }>
  downloadUpdate(): Promise<{ status: boolean, message?: string }>
  quitAndInstall(): Promise<{ status: boolean, message?: string }>
  onStatusChanged(callback: (status: AppUpdateStatus) => void): () => void
}

export interface TmcutDirs {
  base: string
  projects: string
  snapshots: string
  assetsFile: string
  cache: string
  thumbs: string
  waveforms: string
}

export interface TmcutProjectFileInfo {
  id: string
  name: string
  updatedAt: string
  size: number
}

export interface TmcutSnapshotInfo {
  ts: number
  name: string
  updatedAt: string
}

export interface TmcutFileStat {
  exists: boolean
  size: number
  mtimeMs: number
}

export interface TmcutProjectMeta {
  hasProject: boolean
  projectMtimeMs: number
  hasRecovery: boolean
  recoveryUpdatedAtMs: number | null
}

/** One system font face (roadmap C-1): `path` feeds drawtext fontfile= so the export renders the very file the preview family shows. */
export interface TmcutFontEntry {
  family: string
  path: string
  style: string
  weight: number
  italic: boolean
  monospace: boolean
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCompleteInput {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  task?: 'transcribe' | 'triage' | 'plan' | string
  messages: AiChatMessage[]
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  timeoutMs?: number
}

export interface AiCompleteResult {
  content: string
  usage: unknown
  model: string
  latencyMs: number
}

export interface AiModelInfo {
  id: string
  label: string
}

/** One usable AI-LLM connection from the hub relay catalogue (R147 phase 2). */
export interface AiRelayConnection {
  connectionId: string
  provider: string
  name: string
  adapterType: string
  origin: 'own' | 'shared'
  /** Has a stored key (keyless providers like local Ollama report false). */
  hasKey: boolean
  /** Saved default model (hub AI_MODEL config) or null. */
  model: string | null
  models: Array<{ modelId: string, displayName: string, isPrimary?: boolean }>
}

/** Picker entry for the provider select (electron/tools/ai-gateway.cjs presets). */
export interface AiProviderPreset {
  id: string
  label: string
  baseUrl: string
  keyless: boolean
  requiresModel: boolean
  /** True when the provider has no built-in endpoint (aggregator/custom): AI_BASE_URL is required. */
  needsBaseUrl: boolean
}

export interface AiGatewayStatus {
  provider: string
  providerLabel: string
  baseUrl: string
  model: string
  hasKey: boolean
  keyless: boolean
  needsBaseUrl: boolean
  needsModel: boolean
  /** Endpoint + credentials + model all present. */
  configured: boolean
  rpm: number
  timeoutMs: number
}

/** Per-surface entry from tools:ai-gateway:tasks (taskConfig resolution). */
export interface AiTaskStatus {
  provider: string
  providerLabel: string
  baseUrl: string
  model: string
  hasKey: boolean
  /** True when this task's provider differs from the global AI_PROVIDER. */
  overridden: boolean
  /** True when any AI_*_<TASK> slot is set (override editor is active). */
  customized: boolean
  configured: boolean
}

/**
 * R140: at-rest key vault status (main:ai-key-status). COUNTS ONLY —
 * tokens and plaintext values never leave the main process.
 * R141 adds `exists`: a missing config file (fresh install, panel
 * never saved) must not be indistinguishable from a parsed file with
 * zero secret slots — both previously reported 0/0 and looked like a
 * broken migration.
 */
export interface AiKeyVaultStatus {
  /** OS keychain (safeStorage) usable this session. */
  available: boolean
  /** config.env exists on disk (panel has saved at least once). */
  exists: boolean
  /** Secret slots stored encrypted at rest. */
  encrypted: number
  /** Secret slots still in plaintext (pre-R139 or keychain unavailable). */
  plaintext: number
}

export interface AiGatewayNamespace {
  complete(args: AiCompleteInput): Promise<{ ok: boolean, data?: AiCompleteResult, code?: string, error?: string }>
  transcribe(args: { filePath: string, provider?: string, apiKey?: string, baseUrl?: string, model?: string, language?: string, format?: 'text' | 'verbose_json' }): Promise<{ ok: boolean, data?: { text: string, segments?: Array<{ start: number, end: number, text: string }> }, code?: string, error?: string }>
  getStatus(): Promise<AiGatewayStatus>
  /** Per-surface providers (plan = script, triage = autocut, transcribe = captions). */
  tasks(): Promise<{ ok: boolean, data?: { tasks: Record<'plan' | 'triage' | 'transcribe', AiTaskStatus> } }>
  /** GET {base}/models — model discovery for multi-provider gateways (FreeLLMAPI et al.). */
  models(args?: { provider?: string, apiKey?: string, baseUrl?: string }): Promise<{ ok: boolean, data?: { models: AiModelInfo[], provider: string, baseUrl: string, count: number }, code?: string, error?: string }>
  presets(): Promise<{ ok: boolean, data?: { presets: AiProviderPreset[] } }>
}

// =============================================================================
// Video Generation (P4) — main process only, keys never leave main
// =============================================================================

export interface VideoGenerationProvider {
  id: string
  label: string
  capabilities: string[]
  models?: Array<{ id: string, label: string, maxDurationSec?: number, costPerSecond?: number }>
}

export interface VideoGenerationEstimate {
  estimatedCostUsd: number
  costBreakdown: Record<string, unknown>
  budgetWarning: boolean
  validUntil: string
}

export interface VideoGenerationSubmitResult {
  jobId: string
  providerTaskId: string
  status: string
  estimatedCompletionSec: number
}

export interface VideoGenerationPollResult {
  jobId: string
  providerId: string
  providerTaskId: string
  input: Record<string, unknown>
  status: string
  progress: number
  createdAt: string
  updatedAt: string
  results: Array<Record<string, unknown>>
  error: string | null
  costSoFar: number
  etaSec?: number
}

export interface VideoGenerationDownloadResult {
  localPath: string
  originalUrl: string
  checksum: string
  fileSizeBytes: number
  mimeType: string
  width: number
  height: number
  durationSec: number
}

export interface VideoGenerationJobRecord {
  jobId: string
  providerId: string
  providerTaskId: string
  input: Record<string, unknown>
  status: string
  progress: number
  createdAt: string
  updatedAt: string
  results: Array<Record<string, unknown>>
  error: string | null
  costSoFar: number
}

export interface VideoGenerationUsageEntry {
  jobId: string
  providerId: string
  providerTaskId: string
  costUsd: number
  action: string
  at: string
}

export interface VideoGenerationUsageLedgerResult {
  entries: VideoGenerationUsageEntry[]
  totalCostUsd: number
}

export interface VideoGenerationProviderHealthResult {
  healthy: boolean
  providerId: string
  error?: string
  [key: string]: unknown
}

export interface VideoGenerationNamespace {
  /** List available providers (manifests) */
  'providers'(): Promise<{ ok: boolean, data?: VideoGenerationProvider[] }>
  /** Get provider capabilities/manifest (runtime key: 'provider:capabilities'). */
  'provider:capabilities'(args: { providerId: string }): Promise<{ ok: boolean, data?: VideoGenerationProvider }>
  /** Estimate cost for a generation job */
  'estimate'(args: { providerId: string, input: Record<string, unknown> }): Promise<{ ok: boolean, data?: VideoGenerationEstimate }>
  /** Submit a generation job */
  'submit'(args: { providerId: string, input: Record<string, unknown>, idempotencyKey?: string }): Promise<{ ok: boolean, data?: VideoGenerationSubmitResult }>
  /** Poll job status */
  'poll'(args: { jobId: string }): Promise<{ ok: boolean, data?: VideoGenerationPollResult }>
  /** Cancel a job */
  'cancel'(args: { jobId: string }): Promise<{ ok: boolean }>
  /** Download result to Asset Center */
  'download'(args: { jobId: string, destDir?: string }): Promise<{ ok: boolean, data?: VideoGenerationDownloadResult }>
  /** List all jobs (runtime key: 'jobs:list'). */
  'jobs:list'(): Promise<{ ok: boolean, data?: VideoGenerationJobRecord[] }>
  /** Get single job (runtime key: 'jobs:get'). */
  'jobs:get'(args: { jobId: string }): Promise<{ ok: boolean, data?: VideoGenerationJobRecord }>
  /** Retry a failed job (runtime key: 'jobs:retry'). */
  'jobs:retry'(args: { jobId: string }): Promise<{ ok: boolean, data?: VideoGenerationSubmitResult }>
  /** Delete job (runtime key: 'jobs:delete'). */
  'jobs:delete'(args: { jobId: string }): Promise<{ ok: boolean }>
  /** Get usage ledger. */
  'usage-ledger'(args?: { from?: string, to?: string, providerId?: string }): Promise<{ ok: boolean, data?: VideoGenerationUsageLedgerResult }>
  /** Provider health check (runtime key: 'provider:health'). */
  'provider:health'(args: { providerId: string }): Promise<{ ok: boolean, data?: VideoGenerationProviderHealthResult }>
}

export interface DownloadProgressPayload {
  id: string
  loaded: number
  /** Declared content-length, 0 when the server does not say. */
  total: number
  done?: boolean
}

export interface TmcutNamespace {
  getPaths(): Promise<TmcutDirs>
  readAssetsFile(): Promise<unknown>
  writeAssetsFile(data: unknown): Promise<boolean>
  readProject(id: string): Promise<unknown>
  writeProject(args: { id: string, data: unknown }): Promise<boolean>
  listProjectFiles(): Promise<TmcutProjectFileInfo[]>
  readProjectMeta(id: string): Promise<TmcutProjectMeta>
  writeRecovery(args: { id: string, data: unknown }): Promise<boolean>
  readRecovery(id: string): Promise<unknown>
  deleteRecovery(id: string): Promise<boolean>
  deleteProject(id: string): Promise<boolean>
  listSnapshots(id: string): Promise<TmcutSnapshotInfo[]>
  saveSnapshot(args: { id: string, data: unknown, name?: string }): Promise<TmcutSnapshotInfo | null>
  readSnapshot(args: { id: string, ts: number }): Promise<unknown>
  deleteSnapshot(args: { id: string, ts: number }): Promise<boolean>
  statFiles(paths: string[]): Promise<Record<string, TmcutFileStat>>
  voiceStatus(args?: { baseUrl?: string }): Promise<{ ok: boolean, data?: { baseUrl: string, health: unknown, voices: Array<{ name: string, description: string }> }, error?: string }>
  enrollVoice(args: { baseUrl?: string, filePath: string, name: string, description?: string, denoise?: boolean }): Promise<{ ok: boolean, data?: { voice: string, alreadyPresent?: boolean }, error?: string }>
  listManagedVoices(): Promise<Array<{ id: string, name: string, engineName: string, description: string, createdAt: string }>>
  addManagedVoice(args: { filePath: string, name: string, description?: string }): Promise<{ ok: boolean, data?: { id: string, name: string, engineName: string, description: string, referenceFile: string, createdAt: string }, error?: string }>
  deleteManagedVoice(id: string): Promise<{ ok: boolean, error?: string }>
  syncManagedVoice(args: { id: string, baseUrl?: string }): Promise<{ ok: boolean, data?: { voice: string, alreadyPresent?: boolean }, error?: string }>
  synthesizeVoice(args: { baseUrl?: string, text: string, voice: string }): Promise<{ ok: boolean, path?: string, size?: number, error?: string }>
  /** Uses the API key from encrypted desktop config; never pass credentials over renderer IPC. */
  synthesizeGeminiVoice(args: { text: string, voice: string, style?: string, model?: string }): Promise<{ ok: boolean, path?: string, size?: number, error?: string }>
  /**
   * Recording blob persistence (roadmap D-4): writes into <base>/recordings/,
   * returns the path. `prefix` names non-voiceover takes (e.g. a command clip
   * captured for speech-to-text); it defaults to `voiceover`.
   */
  saveRecording(args: { data: Uint8Array, ext?: string, prefix?: string }): Promise<{ ok: boolean, path?: string, error?: string }>
  /**
   * Generated media download (P4 groundwork): pulls an http(s) URL into
   * <base>/downloads/ so the renderer can import a real local file. Refuses
   * non-http(s) schemes, existing names (suffixed instead), oversized bodies.
   */
  downloadMedia(args: { url: string, filename?: string, id?: string }): Promise<{ ok: boolean, path?: string, name?: string, bytes?: number, error?: string }>
  /** Abort an in-flight download; the pending promise settles with 'cancelled'. */
  cancelDownload(id: string): Promise<boolean>
  /**
   * Stock media search (kho tài nguyên). Main fetches the provider URL after
   * enforcing the https + host allowlist, the `Authorization`-only header
   * rule, a 15 s timeout and a 2 MiB body cap, and returns parsed JSON.
   */
  stockSearch(args: { url: string, headers?: Record<string, string> }): Promise<{ ok: boolean, status?: number, data?: unknown, error?: string }>
  /** Byte progress for a download started with the same `id`. */
  onDownloadProgress(callback: (payload: DownloadProgressPayload) => void): () => void
  /** System font faces with file paths (roadmap C-1). Empty array when the scanner addon cannot load. */
  listFonts(): Promise<TmcutFontEntry[]>
  /** On-demand Asset Center (roadmap v3 PART A): registry + verified installs. */
  assetCenter: TmcutAssetCenterNamespace
}

/**
 * Production process artifact store (docs/production-process). Artifacts are
 * real files under <userData>/tmcut/process/runs/<runId>/, one directory per
 * version; the stage machine that decides WHEN to write them lives in the
 * renderer (`utils/process/stageMachine.ts`). Every call answers an envelope
 * so a refused path is a message instead of an exception.
 */
export interface ProcessStoreEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface ProcessNamespace {
  root(): Promise<ProcessStoreEnvelope<{ path: string }>>
  openRoot(): Promise<ProcessStoreEnvelope<{ path: string }>>
  list(): Promise<ProcessStoreEnvelope<Array<{
    runId: string
    title: string
    status: string
    processId: string
    processVersion: string
    currentStage: string
    updatedAt: string
    artifacts: number
  }>>>
  read(runId: string): Promise<ProcessStoreEnvelope<Record<string, unknown>>>
  save(payload: { runId: string, run: unknown }): Promise<ProcessStoreEnvelope<{ file: string }>>
  writeArtifact(payload: { runId: string, name: string, content: string }): Promise<ProcessStoreEnvelope<{ version: number, hash: string, file: string }>>
  readArtifact(payload: { runId: string, name: string, version?: number }): Promise<ProcessStoreEnvelope<{ version: number, content: string }>>
}

/**
 * Roadmap v3 PART A — the Asset Center I/O surface. The download-queue
 * state machine lives renderer-side in tmcut-core; these channels are
 * thin path-pinned primitives (the controller sanitizes entryId/version/
 * filename and refuses anything resolving outside the asset-center base).
 */
export interface TmcutAssetCenterNamespace {
  getDirs(): Promise<{ base: string, packages: string }>
  readRegistry(): Promise<unknown[]>
  writeRegistry(list: unknown[]): Promise<boolean>
  readCatalogCache(): Promise<unknown>
  writeCatalogCache(catalog: unknown): Promise<boolean>
  /** Starter catalog shipped inside the installer (small starter set). */
  readStarterCatalog(): Promise<unknown>
  /** Absolute path of a bundled sample file, or null for unknown ids. */
  getSamplePath(sampleId: string): Promise<string | null>
  downloadPackage(args: {
    jobId: string
    url: string
    entryId: string
    version: string
    filename?: string
    expectSha256?: string
    expectBytes?: number
  }): Promise<{ ok: boolean, path?: string, sha256?: string, size?: number, reason?: string }>
  /** Install from a local file (bundled sample): copy + checksum gate + atomic commit. */
  installLocal(args: {
    jobId: string
    sourcePath: string
    entryId: string
    version: string
    filename?: string
    expectSha256?: string
  }): Promise<{ ok: boolean, path?: string, sha256?: string, size?: number, reason?: string }>
  cancelDownload(jobId: string): Promise<boolean>
  removePackageDir(args: { entryId: string, version: string }): Promise<{ ok: boolean, reason?: string }>
  verifyFile(args: { entryId: string, version: string, filename?: string, expectSha256?: string }): Promise<{ ok: boolean, sha256?: string, size?: number, reason?: string }>
  onProgress(callback: (payload: { jobId: string, entryId: string, loaded: number, total: number }) => void): () => void
}

export interface ProfileGroup {
  id: string
  name: string
  color?: string
  icon?: string
  description?: string
  sort?: number
  profile_count?: number
  created_at?: string
  updated_at?: string
}

export interface ProfileProxy {
  id: string
  name: string
  type: 'http' | 'socks5' | 'ssh' | string
  host: string
  port: number
  username?: string
  password?: string
  status?: 'active' | 'dead' | 'unknown' | 'checking' | string
  country?: string
  country_code?: string
  ip?: string
  latency_ms?: number
  last_checked_at?: string
  profile_count?: number
  created_at?: string
  updated_at?: string
}

export interface ProfileAccount {
  id: string
  profile_id: string
  platform: 'facebook' | 'google' | 'tiktok' | 'x' | 'amazon' | 'other' | string
  username: string
  password?: string
  two_fa_secret?: string
  recovery_email?: string
  status?: string
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface BrowserProfile {
  id: string
  name: string
  group_id?: string | null
  group_name?: string
  group_color?: string
  group_icon?: string
  proxy_id?: string | null
  proxy_name?: string
  proxy_type?: string
  proxy_host?: string
  proxy_port?: number
  proxy_country?: string
  proxy_status?: string
  raw_proxy?: string | null
  browser_id?: string | null
  browser_type?: 'chrome' | 'brave' | 'firefox' | 'camoufox' | 'donut' | 'browser_oxide' | 'custom' | string
  browser_engine?: 'chromium' | 'firefox' | 'camoufox' | 'donut' | 'browser_oxide' | 'custom' | string
  browser_version?: string
  custom_exe?: string | null
  stealth_mode?: boolean
  stealth_engine?: 'none' | 'playwright_stealth' | 'camoufox_native' | 'custom' | string
  os?: 'windows' | 'macos' | 'linux' | 'android' | string
  user_agent?: string | null
  screen_resolution?: string
  color_depth?: number
  hardware_concurrency?: number
  device_memory?: number
  languages?: string
  webrtc_mode?: 'disabled' | 'fake' | 'proxy' | 'real' | string
  timezone_mode?: 'auto' | 'manual' | string
  timezone_val?: string
  geo_mode?: 'auto' | 'manual' | string
  geo_lat?: number | null
  geo_lng?: number | null
  geo_accuracy?: number
  canvas_mode?: 'noise' | 'off' | 'block' | string
  webgl_mode?: 'noise' | 'custom' | 'off' | string
  webgl_vendor?: string
  webgl_renderer?: string
  audio_mode?: 'noise' | 'off' | string
  client_rects_mode?: 'noise' | 'off' | string
  fonts_mode?: 'system' | 'custom' | 'masked' | string
  fonts_list?: string[]
  extensions?: string[]
  start_url?: string
  notes?: string | null
  tags?: string[]
  sort?: number
  flag?: number
  last_launched_at?: string | null
  created_at?: string
  updated_at?: string
  isRunning?: boolean
  runningPid?: number | null
  accounts?: ProfileAccount[]
}

export interface ProfileFilters {
  groupId?: string
  search?: string
  status?: string
  limit?: number
  offset?: number
}

export interface ProfilesListResult {
  items: BrowserProfile[]
  total: number
  limit: number
  offset: number
}

export interface ProfilesNamespace {
  listProfiles(filters?: ProfileFilters): Promise<{ success: boolean, data?: ProfilesListResult, error?: string }>
  getProfile(id: string): Promise<{ success: boolean, data?: BrowserProfile, error?: string }>
  createProfile(data: Partial<BrowserProfile>): Promise<{ success: boolean, data?: { id: string }, error?: string }>
  updateProfile(args: { id: string, data: Partial<BrowserProfile> }): Promise<{ success: boolean, error?: string }>
  deleteProfiles(idOrIds: string | string[]): Promise<{ success: boolean, data?: { changes: number }, error?: string }>
  cloneProfile(args: { id: string, newName?: string }): Promise<{ success: boolean, data?: { id: string }, error?: string }>
  listGroups(): Promise<{ success: boolean, data?: ProfileGroup[], error?: string }>
  saveGroup(groupData: Partial<ProfileGroup>): Promise<{ success: boolean, data?: { id: string }, error?: string }>
  deleteGroup(id: string): Promise<{ success: boolean, error?: string }>
  listProxies(): Promise<{ success: boolean, data?: ProfileProxy[], error?: string }>
  saveProxy(proxyData: Partial<ProfileProxy>): Promise<{ success: boolean, data?: { id: string }, error?: string }>
  deleteProxy(id: string): Promise<{ success: boolean, error?: string }>
  checkProxy(proxy: Partial<ProfileProxy>): Promise<{ success: boolean, data?: { ip?: string, latency_ms?: number, status?: string }, error?: string }>
  launchBrowser(args: { profileId: string, customExe?: string }): Promise<{ success: boolean, data?: { pid: number, port: number, profileId: string }, error?: string }>
  stopBrowser(profileId: string): Promise<{ success: boolean, error?: string }>
  getRunningProfiles(): Promise<{ success: boolean, data?: { id: string, pid: number, port: number, startedAt: string }[] }>
  openProfileFolder(id: string): Promise<{ success: boolean, data?: { path: string }, error?: string }>
  clearProfileCache(id: string): Promise<{ success: boolean, error?: string }>
  detectBrowserExecutable(): Promise<{ success: boolean, data?: { executablePath: string | null }, error?: string }>
  onStatusChanged?(callback: (status: { profileId: string, isRunning: boolean, pid?: number }) => void): () => void
}

export interface ElectronAPI {
  platform: string
  versions: {
    node: string
    chrome: string
    electron: string
  }
  isElectron: boolean
  /** External file drop (roadmap G-2): dropped File → absolute path (Electron 32+ removed File.path). */
  getPathForFile(file: File): string
  getConfig(): Promise<Record<string, string>>
  setConfig(values: Record<string, string>): Promise<{ success: boolean, path: string }>
  /** v2 device-auth boundary: Main holds the machine id and the device credential. */
  deviceAuth?: DeviceAuthNamespace
  /** R140 (§204): at-rest key vault status — counts only, never tokens. */
  aiKeyStatus(): Promise<{ ok: boolean, data?: AiKeyVaultStatus }>
  /** R143 (§206): re-run the idempotent at-rest migration; fresh counts. */
  aiMigrateKeys(): Promise<{ ok: boolean, data?: AiKeyVaultStatus }>
  verifyPath(filePath: string, type: 'ytDlp'): Promise<{ status: boolean }>
  openPath(fullPath: string): Promise<boolean>
  openExternal(url: string): Promise<boolean>
  showItemInFolder(fullPath: string): Promise<boolean>
  send(channel: string, data?: unknown): void
  on(channel: string, callback: (...args: unknown[]) => void): void
  tools: {
    profiles: ProfilesNamespace
    aiGateway: AiGatewayNamespace
    videoGeneration: VideoGenerationNamespace
  }
  dialog: DialogNamespace
  fileManager: FileManagerNamespace
  tmcut: TmcutNamespace
  /** Production process artifacts (stage → artifact → gate). */
  process: ProcessNamespace
  appUpdater?: AppUpdaterNamespace
  system: {
    getInfo(): Promise<ApiResponse<SystemInfoResponse>>
    openDirectory(input: OpenDirectoryInput): Promise<ApiResponse<void>>
    getStorageUsage(): Promise<ApiResponse<StorageUsage>>
  }
  events: {
    on<K extends keyof EventBusContracts>(
      event: K,
      callback: (payload: EventBusContracts[K]) => void
    ): () => void
  }
  mcp: {
    onToolInvoke(callback: (data: { tool: string, params: Record<string, unknown>, requestId: string, projectId: string }) => void): () => void
    respond(requestId: string, result: unknown): void
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

/** Hub session payload as returned to the renderer (a device credential never appears here). */
export interface DeviceAuthSession {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: {
    id: string
    email: string
    name: string
    username?: string | null
    avatarUrl?: string | null
    roles?: string[]
    permissions?: string[]
    allowedRoutes?: string[]
    appId?: string
    prefix?: string
    platform?: string
    createdAt?: string
    updatedAt?: string
  }
}

/** TOTP challenge: authenticating with a password only, no session and no credential. */
export interface DeviceAuthTotpChallenge {
  totpRequired: true
  pendingTotpToken: string
  user: { id: string, email: string, name: string }
}

export type DeviceAuthResult
  = | {
    success: true
    data: DeviceAuthSession | DeviceAuthTotpChallenge
    /** True when Main stored a newly issued device credential in the vault. */
    credentialPersisted?: boolean
  }
  | {
    success: false
    code: 'notConfigured' | 'unreachable' | 'rejected' | 'invalidRequest' | 'untrusted'
    status?: number
    statusMessage?: string
    message?: string
  }

/**
 * Device credential metadata. The issued credential stays in the main process
 * vault and is never part of this surface.
 */
export interface DeviceStatus {
  enrolled: boolean
  deviceId: string
  appId: string
  userId: string
  /** Hub this build currently points at. */
  hubUrl?: string
  /** Hub that issued the stored credential (absent on pre-scoping rows). */
  hubOrigin?: string
  expiresAt: string
  scopes: string[]
}

/**
 * Main-process auth boundary for Electron. Every call carries the machine-derived
 * device identity; only the session (or a TOTP challenge) comes back.
 */
export interface DeviceAuthNamespace {
  info(): Promise<HubDeviceInfo | null>
  login(credentials: { email: string, password: string }): Promise<DeviceAuthResult>
  verifyTotp(input: { code: string, pendingTotpToken: string }): Promise<DeviceAuthResult>
  passkeyStart(): Promise<{ success: true, data: unknown } | { success: false, code: string, statusMessage?: string, message?: string }>
  passkeyFinish(credential: unknown): Promise<DeviceAuthResult>
  register(input: { email: string, password: string, name: string }): Promise<DeviceAuthResult>
  credentialStatus(): Promise<DeviceStatus>
  /** Local-only: removes the stored credential. Revoking the Hub record is a root action on the Hub. */
  forgetCredential(): Promise<{ success: boolean, enrolled?: boolean, code?: 'untrusted' }>
}
