import type { HeaderActionChild } from '~/components/base/HeaderActions.vue'
import { getErrorMessage } from '~/shared/utils/errors'

export type ExportFormat = 'csv' | 'json' | 'xlsx'

export interface ExportJobLike {
  id: string
  module: string
  format: string
  appId?: string
  options?: { filename?: string }
}

export function buildExportFilename(job: ExportJobLike): string {
  const raw = job.options?.filename?.trim() || `${job.module}-export-${job.id.slice(0, 8)}`
  const base = raw.replace(/\.(csv|json|xlsx)$/i, '')
  const prefixed = base.startsWith(`${job.module}-`) ? base : `${job.module}-${base}`
  const appPrefix = job.appId && !prefixed.startsWith(`${job.appId}-`) ? `${job.appId}-` : ''
  return `${appPrefix}${prefixed}.${job.format}`
}

export function buildExportChildren(
  t: (key: string) => string,
  run: (format: ExportFormat) => void
): HeaderActionChild[] {
  return [
    { key: 'export-csv', icon: 'i-lucide-file-spreadsheet', label: t('admin.export.toCsv'), onSelect: () => run('csv') },
    { key: 'export-json', icon: 'i-lucide-file-json', label: t('admin.export.toJson'), onSelect: () => run('json') }
  ]
}

export function useModuleExport() {
  const { t } = useI18n()
  const toast = useToast()
  const { hubFetch, appId } = useHub()

  const exporting = ref(false)

  async function exportModule(targetAppOrModule: string, moduleOrFormat?: string, formatParam?: ExportFormat): Promise<void> {
    let effectiveAppId = appId
    let effectiveModule = targetAppOrModule
    let effectiveFormat: ExportFormat = 'csv'

    if (moduleOrFormat && (moduleOrFormat === 'csv' || moduleOrFormat === 'json' || moduleOrFormat === 'xlsx')) {
      effectiveModule = targetAppOrModule
      effectiveFormat = moduleOrFormat as ExportFormat
    } else if (moduleOrFormat && formatParam) {
      effectiveAppId = targetAppOrModule
      effectiveModule = moduleOrFormat
      effectiveFormat = formatParam
    }

    if (!effectiveAppId) {
      toast.add({ title: t('admin.export.startFailed'), color: 'error' })
      return
    }

    exporting.value = true
    try {
      const res = await hubFetch<{ success: boolean, data: { id: string, status: string, totalRecords?: number, format: string, module: string, appId?: string } }>(
        `/api/v1/apps/${encodeURIComponent(effectiveAppId)}/export/${encodeURIComponent(effectiveModule)}`,
        { method: 'POST', body: { options: { format: effectiveFormat, scope: 'all' } } }
      )
      const job = res.data
      if (job && (job.status === 'completed' || job.status === 'pending')) {
        if (job.status === 'completed') {
          const raw = await hubFetch<Blob | ArrayBuffer | string>(
            `/api/v1/apps/${encodeURIComponent(effectiveAppId)}/export/jobs/${encodeURIComponent(job.id)}/download`,
            { responseType: 'blob' }
          )
          const blob = raw instanceof Blob ? raw : new Blob([raw as unknown as BlobPart])
          const filename = buildExportFilename({ ...job, appId: effectiveAppId })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
        }
        toast.add({ title: t('admin.export.started', { records: job.totalRecords || 0 }), icon: 'i-lucide-check', color: 'success' })
      } else {
        toast.add({ title: t('admin.export.startFailed'), color: 'error' })
      }
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    } finally {
      exporting.value = false
    }
  }

  return { exporting, exportModule }
}
