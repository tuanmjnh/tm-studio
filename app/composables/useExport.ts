import type { HubExportFormat, HubExportJob, HubExportOptions, HubExportScope, HubExportTemplate } from 'tm-hub-client'
import { getErrorMessage } from '~/shared/utils/errors'

const MODULES = ['users', 'roles', 'routes', 'permissions', 'notifications', 'configs', 'media', 'logs'] as const
const FORMATS: HubExportFormat[] = ['csv', 'json', 'xlsx']
const SCOPES: HubExportScope[] = ['all', 'page', 'filtered']

function buildExportFilename(job: HubExportJob): string {
  const raw = job.options?.filename?.trim() || `${job.module}-export-${job.id.slice(0, 8)}`
  const base = raw.replace(/\.(csv|json|xlsx)$/i, '')
  const withModule = base.startsWith(`${job.module}-`) ? base : `${job.module}-${base}`
  const appPrefix = job.appId && !withModule.startsWith(`${job.appId}-`) ? `${job.appId}-` : ''
  return `${appPrefix}${withModule}.${job.format}`
}

export function useExport() {
  const { t } = useI18n()
  const toast = useToast()
  const { appId, export: exportApi } = useHub()

  const jobs = ref<HubExportJob[]>([])
  const jobTotal = ref(0)
  const loadingJobs = ref(false)
  const starting = ref(false)
  const downloadingId = ref<string | null>(null)
  const page = ref(1)
  const pageSize = 10

  const templates = ref<HubExportTemplate[]>([])
  const loadingTemplates = ref(false)
  const savingTemplate = ref(false)

  const filters = reactive({ module: 'all' })

  const form = reactive({
    module: 'users',
    format: 'csv' as HubExportFormat,
    scope: 'all' as HubExportScope,
    limit: 100
  })

  async function loadJobs(p = 1): Promise<void> {
    loadingJobs.value = true
    try {
      const res = await exportApi.jobs({
        module: filters.module !== 'all' ? filters.module : undefined,
        limit: pageSize,
        offset: (p - 1) * pageSize
      })
      jobs.value = res.data || []
      const meta = res.meta as { total?: number } | undefined
      jobTotal.value = meta?.total ?? jobs.value.length
      page.value = p
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    } finally {
      loadingJobs.value = false
    }
  }

  async function start(): Promise<void> {
    starting.value = true
    try {
      const options: HubExportOptions = {
        format: form.format,
        scope: form.scope,
        limit: form.scope === 'page' ? form.limit : undefined
      }
      const res = await exportApi.start(form.module, options)
      const job = res.data
      if (job?.status === 'completed') {
        toast.add({ title: t('admin.export.started', { records: job.totalRecords }), icon: 'i-lucide-check', color: 'success' })
      } else {
        toast.add({ title: t('admin.export.startFailed'), color: 'error' })
      }
      await loadJobs(1)
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    } finally {
      starting.value = false
    }
  }

  async function download(job: HubExportJob): Promise<void> {
    downloadingId.value = job.id
    try {
      const blob = await exportApi.download(job.id)
      const filename = buildExportFilename(job)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    } finally {
      downloadingId.value = null
    }
  }

  async function remove(job: HubExportJob): Promise<void> {
    try {
      await exportApi.deleteJob(job.id)
      toast.add({ title: t('admin.export.jobDeleted'), icon: 'i-lucide-check', color: 'success' })
      await loadJobs(page.value)
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    }
  }

  async function loadTemplates(): Promise<void> {
    loadingTemplates.value = true
    try {
      const res = await exportApi.templates()
      templates.value = res.data || []
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    } finally {
      loadingTemplates.value = false
    }
  }

  async function saveAsTemplate(name: string): Promise<void> {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    savingTemplate.value = true
    try {
      const options: HubExportOptions = { format: form.format, scope: form.scope }
      await exportApi.createTemplate({ module: form.module, name: trimmed, options })
      toast.add({ title: t('admin.export.templateSaved'), icon: 'i-lucide-check', color: 'success' })
      await loadTemplates()
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    } finally {
      savingTemplate.value = false
    }
  }

  function applyTemplate(tpl: HubExportTemplate): void {
    form.module = tpl.module
    form.format = tpl.options?.format || 'csv'
    form.scope = tpl.options?.scope || 'all'
    if (tpl.options?.limit) form.limit = tpl.options.limit
    toast.add({ title: t('admin.export.templateApplied'), icon: 'i-lucide-check', color: 'success' })
  }

  async function removeTemplate(tpl: HubExportTemplate): Promise<void> {
    try {
      await exportApi.deleteTemplate(tpl.id)
      toast.add({ title: t('admin.export.templateDeleted'), icon: 'i-lucide-check', color: 'success' })
      await loadTemplates()
    } catch (err: unknown) {
      toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    }
  }

  return {
    MODULES,
    FORMATS,
    SCOPES,
    appId,
    jobs,
    jobTotal,
    loadingJobs,
    starting,
    downloadingId,
    page,
    pageSize,
    templates,
    loadingTemplates,
    savingTemplate,
    filters,
    form,
    loadJobs,
    start,
    download,
    remove,
    loadTemplates,
    saveAsTemplate,
    applyTemplate,
    removeTemplate
  }
}
