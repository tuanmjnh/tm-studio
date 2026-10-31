<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VideoTemplate, TemplateInputField, SceneBlueprint, PromptBlock } from '~/types/videoTemplate'
import { useVideoTemplates, type VideoTemplateFamily } from '~/composables/useVideoTemplates'
import { cloneTemplate, runTemplateDryRun, sampleRecordFor, type TemplateDryRun } from '~/utils/tmcut/videoTemplates'

// Template Studio (Roadmap v1 §5, P3): list template families, fork a draft
// from any published version, edit the draft with live validation, dry-run it
// against sample inputs, then publish an immutable version.
//
// This component only talks to `useVideoTemplates`; the lifecycle rules
// (immutability, one published per family, publish-gating) live in the pure
// util, not here.
const emit = defineEmits<{
  (e: 'changed'): void
}>()

const { t } = useI18n()
const toast = useToast()
const {
  families,
  getVersion,
  publishedVersion,
  draftVersion,
  createDraft,
  updateDraft,
  publish,
  duplicate,
  deleteFamily,
  validate
} = useVideoTemplates()

const mode = ref<'list' | 'edit'>('list')
const editing = ref<VideoTemplate | null>(null)
const deleteTarget = ref<VideoTemplateFamily | null>(null)
const deleteModalOpen = ref(false)

// --- Test run state ---------------------------------------------------------
const testRecord = ref<Record<string, unknown>>({})
const testResult = ref<TemplateDryRun | null>(null)
const testRanAt = ref('')

const validation = computed(() => (editing.value ? validate(editing.value) : null))
const canPublish = computed(() => validation.value?.valid ?? false)

const inputTypes: TemplateInputField['type'][] = ['text', 'textarea', 'number', 'select', 'media', 'color', 'boolean', 'date']
const sceneRoles: SceneBlueprint['role'][] = ['hook', 'intro', 'problem', 'solution', 'demo', 'benefit', 'social-proof', 'cta', 'outro']
const shotTypes: SceneBlueprint['shotType'][] = ['wide', 'medium', 'closeup', 'extreme-closeup', 'pov', 'drone', 'screen-record', 'animation', 'graphic']
const blockTypes: PromptBlock['type'][] = ['system', 'style-bible', 'shot-template', 'negative-constraints', 'localization']

function inputTypeItems() {
  return inputTypes.map(type => ({ value: type, label: tr(`tmcut.videoTemplates.inputTypes.${type}`, type) }))
}
function roleItems() {
  return sceneRoles.map(role => ({ value: role, label: tr(`tmcut.videoTemplates.roles.${role}`, role) }))
}
function shotItems() {
  return shotTypes.map(shot => ({ value: shot, label: tr(`tmcut.videoTemplates.shots.${shot}`, shot) }))
}
function blockTypeItems() {
  return blockTypes.map(type => ({ value: type, label: tr(`tmcut.videoTemplates.blockTypes.${type}`, type) }))
}

function describeErrors(count: number, warningCount: number): string {
  return count > 0
    ? t('tmcut.videoTemplates.errorCount', { count })
    : t('tmcut.videoTemplates.warningCount', { count: warningCount })
}

function topicLabel(topic: string): string {
  return tr(`tmcut.videoTemplates.topics.${topic}`, topic)
}

/** Translate an optional enum label, falling back to the raw schema value. */
function tr(key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

/** Test-run record values are plain strings for UInput, coerced on run. */
function recordValue(fieldId: string): string {
  const value = testRecord.value[fieldId]
  return value === undefined || value === null ? '' : String(value)
}

function setRecord(fieldId: string, value: string) {
  testRecord.value = { ...testRecord.value, [fieldId]: value }
}

function failureMessage(code?: string, message?: string): string {
  if (code === 'template-not-found') return t('tmcut.videoTemplates.notFound')
  if (code === 'validation-failed') return t('tmcut.videoTemplates.publishBlocked', { count: validation.value?.errors.length ?? 0 })
  return message || t('tmcut.videoTemplates.actionFailed')
}

// --- List actions -----------------------------------------------------------

/**
 * Enter the editor for a family: reuse its draft, or fork one from the
 * published version (one draft per family — repeated clicks never fork twice).
 */
function openFamily(family: VideoTemplateFamily) {
  let template = draftVersion(family.templateId)
  if (!template) {
    const base = publishedVersion(family.templateId) || getVersion(family.templateId, family.latestVersion)
    if (!base) {
      toast.add({ title: t('tmcut.videoTemplates.notFound'), color: 'error' })
      return
    }
    const result = createDraft(family.templateId, base.version)
    if (!result.ok || !result.template) {
      toast.add({ title: failureMessage(result.error?.code, result.error?.message), color: 'error' })
      return
    }
    template = result.template
  }
  editing.value = cloneTemplate(template)
  testRecord.value = sampleRecordFor(template)
  testResult.value = null
  mode.value = 'edit'
}

function handleDuplicate(family: VideoTemplateFamily) {
  const base = publishedVersion(family.templateId) || getVersion(family.templateId, family.latestVersion)
  if (!base) return
  const result = duplicate(family.templateId, base.version)
  if (!result.ok || !result.template) {
    toast.add({ title: failureMessage(result.error?.code, result.error?.message), color: 'error' })
    return
  }
  emit('changed')
  toast.add({ title: t('tmcut.videoTemplates.duplicated', { name: result.template.name }), color: 'success' })
}

function handleDelete(family: VideoTemplateFamily) {
  const result = deleteFamily(family.templateId)
  if (!result.ok) {
    toast.add({ title: failureMessage(result.error?.code, result.error?.message), color: 'warning' })
    deleteTarget.value = null
    return
  }
  emit('changed')
  toast.add({ title: t('tmcut.videoTemplates.deleted'), color: 'success' })
  deleteTarget.value = null
}

// --- Editor actions ---------------------------------------------------------

function backToList() {
  editing.value = null
  mode.value = 'list'
}

function saveDraft(): boolean {
  const template = editing.value
  if (!template) return false
  const result = updateDraft(template.templateId, template.version, {
    name: template.name,
    description: template.description,
    topic: template.topic,
    tags: [...template.tags],
    inputSchema: template.inputSchema,
    sceneBlueprints: template.sceneBlueprints,
    promptBlocks: template.promptBlocks,
    scriptBlueprint: template.scriptBlueprint,
    assetPolicy: template.assetPolicy,
    providerPolicy: template.providerPolicy,
    assemblyProfile: template.assemblyProfile,
    qualityGates: template.qualityGates
  })
  if (!result.ok) {
    toast.add({ title: failureMessage(result.error?.code, result.error?.message), color: 'error' })
    return false
  }
  emit('changed')
  toast.add({ title: t('tmcut.videoTemplates.saved'), color: 'success' })
  return true
}

function handlePublish() {
  if (!saveDraft()) return
  const template = editing.value
  if (!template) return
  const result = publish(template.templateId, template.version, ['Edited in Template Studio'])
  if (!result.ok) {
    toast.add({
      title: failureMessage(result.error?.code, result.error?.message),
      description: validation.value?.errors[0]?.message,
      color: 'error'
    })
    return
  }
  emit('changed')
  toast.add({ title: t('tmcut.videoTemplates.published', { version: template.version }), color: 'success' })
  backToList()
}

// --- Draft field editing ----------------------------------------------------

function addInput() {
  const template = editing.value
  if (!template) return
  const index = template.inputSchema.length + 1
  template.inputSchema.push({
    id: `field${index}`,
    label: t('tmcut.videoTemplates.newInputLabel'),
    type: 'text',
    required: false
  })
}

function removeInput(id: string) {
  const template = editing.value
  if (!template) return
  template.inputSchema = template.inputSchema.filter(field => field.id !== id)
}

function addScene() {
  const template = editing.value
  if (!template) return
  const order = template.sceneBlueprints.length
  template.sceneBlueprints.push({
    id: `scene-${order + 1}`,
    order,
    role: 'demo',
    shotType: 'medium',
    visualIntent: '',
    durationTargetSec: 5,
    onScreenText: '',
    assetPolicy: { source: 'generate', fallbackToGenerate: true },
    providerCapabilities: ['video-gen']
  })
}

function removeScene(id: string) {
  const template = editing.value
  if (!template) return
  template.sceneBlueprints = template.sceneBlueprints
    .filter(scene => scene.id !== id)
    .map((scene, index) => ({ ...scene, order: index }))
}

function addPromptBlock() {
  const template = editing.value
  if (!template) return
  template.promptBlocks.push({
    id: `block-${template.promptBlocks.length + 1}`,
    type: 'shot-template',
    content: '',
    appliesTo: ['scene']
  })
}

function removePromptBlock(id: string) {
  const template = editing.value
  if (!template) return
  template.promptBlocks = template.promptBlocks.filter(block => block.id !== id)
}

// --- Test run ---------------------------------------------------------------

function runTest() {
  const template = editing.value
  if (!template) return
  const result = runTemplateDryRun(template, testRecord.value)
  testResult.value = result
  testRanAt.value = new Date().toLocaleTimeString()
  toast.add({
    title: result.ok ? t('tmcut.videoTemplates.testOk') : t('tmcut.videoTemplates.testFailed'),
    description: result.ok
      ? t('tmcut.videoTemplates.testOkDesc', { count: result.sceneCount ?? 0, duration: result.durationSec ?? 0 })
      : (result.validation.errors[0]?.message || ''),
    color: result.ok ? 'success' : 'warning'
  })
}
</script>

<template>
  <div>
    <!-- ================================================================ -->
    <!-- Family list -->
    <!-- ================================================================ -->
    <div v-if="mode === 'list'">
      <div
        v-if="families.length === 0"
        class="border border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl p-10 text-center"
      >
        <UIcon name="i-lucide-layers" class="size-8 mx-auto text-neutral-400 mb-2" />
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ t('tmcut.videoTemplates.noFamilies') }}
        </p>
        <p class="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
          {{ t('tmcut.videoTemplates.noFamiliesDesc') }}
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="family in families"
          :key="family.templateId"
          class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 flex flex-col gap-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                  {{ family.name }}
                </h3>
                <UBadge
                  v-if="family.builtin"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ t('tmcut.videoTemplates.builtin') }}
                </UBadge>
              </div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                {{ topicLabel(family.topic) }}
              </p>
            </div>
            <UDropdownMenu
              :items="[
                [
                  { label: t('tmcut.videoTemplates.duplicate'), icon: 'i-lucide-copy', onSelect: () => handleDuplicate(family) },
                  {
                    label: t('tmcut.videoTemplates.delete'),
                    icon: 'i-lucide-trash-2',
                    color: 'error',
                    disabled: family.builtin,
                    onSelect: () => { deleteTarget = family; deleteModalOpen = true }
                  }
                ]
              ]"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis-vertical"
                size="xs"
              />
            </UDropdownMenu>
          </div>

          <div class="flex items-center gap-1.5 flex-wrap">
            <UBadge
              v-if="family.publishedVersion"
              color="success"
              variant="subtle"
              size="xs"
            >
              {{ t('tmcut.videoTemplates.publishedBadge', { version: family.publishedVersion }) }}
            </UBadge>
            <UBadge
              v-if="family.draftVersion"
              color="warning"
              variant="subtle"
              size="xs"
            >
              {{ t('tmcut.videoTemplates.draftBadge', { version: family.draftVersion }) }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="xs">
              {{ t('tmcut.videoTemplates.versionCount', { count: family.versionCount }) }}
            </UBadge>
          </div>

          <div class="mt-auto flex items-center gap-2">
            <UButton
              color="primary"
              variant="soft"
              size="sm"
              icon="i-lucide-pencil"
              class="flex-1"
              @click="openFamily(family)"
            >
              {{ t('tmcut.videoTemplates.editDraft') }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-play"
              :title="t('tmcut.videoTemplates.testRunHint')"
              @click="openFamily(family)"
            >
              {{ t('tmcut.videoTemplates.testRun') }}
            </UButton>
          </div>
        </div>
      </div>

      <!-- Delete confirmation -->
      <UModal v-model:open="deleteModalOpen" :ui="{ content: 'max-w-md' }">
        <template #content>
          <div class="p-6">
            <h3 class="text-base font-semibold text-neutral-900 dark:text-white">
              {{ t('tmcut.videoTemplates.deleteTitle') }}
            </h3>
            <p class="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
              {{ t('tmcut.videoTemplates.deleteDesc', { name: deleteTarget?.name || '' }) }}
            </p>
            <div class="flex items-center gap-2 mt-5">
              <UButton
                color="error"
                variant="soft"
                icon="i-lucide-trash-2"
                @click="handleDelete(deleteTarget!)"
              >
                {{ t('tmcut.videoTemplates.delete') }}
              </UButton>
              <UButton color="neutral" variant="ghost" @click="deleteTarget = null">
                {{ t('tmcut.videoTemplates.cancel') }}
              </UButton>
            </div>
          </div>
        </template>
      </UModal>
    </div>

    <!-- ================================================================ -->
    <!-- Draft editor -->
    <!-- ================================================================ -->
    <div v-else-if="editing" class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-arrow-left"
            @click="backToList"
          >
            {{ t('tmcut.videoTemplates.back') }}
          </UButton>
          <UBadge color="warning" variant="subtle" size="sm">
            {{ t('tmcut.videoTemplates.draftBadge', { version: editing.version }) }}
          </UBadge>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            icon="i-lucide-save"
            :disabled="!validation?.valid"
            @click="saveDraft"
          >
            {{ t('tmcut.videoTemplates.saveDraft') }}
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-upload-cloud"
            :disabled="!canPublish"
            :title="canPublish ? t('tmcut.videoTemplates.publish') : t('tmcut.videoTemplates.publishBlockedTitle')"
            @click="handlePublish"
          >
            {{ t('tmcut.videoTemplates.publish') }}
          </UButton>
        </div>
      </div>

      <!-- Live validation -->
      <div
        v-if="validation && (validation.errors.length > 0 || validation.warnings.length > 0)"
        class="rounded-lg border p-3"
        :class="validation.errors.length > 0
          ? 'border-red-500/40 bg-red-500/10'
          : 'border-amber-500/40 bg-amber-500/10'"
      >
        <p
          class="text-xs font-semibold"
          :class="validation.errors.length > 0 ? 'text-red-300' : 'text-amber-300'"
        >
          {{ describeErrors(validation.errors.length, validation.warnings.length) }}
        </p>
        <ul class="mt-1.5 space-y-1 text-[11px] font-mono max-h-32 overflow-y-auto">
          <li v-for="error in validation.errors" :key="error.path + error.code" class="text-red-200/90">
            {{ error.path }} — {{ error.message }}
          </li>
          <li v-for="warning in validation.warnings" :key="warning.path + warning.code" class="text-amber-200/90">
            {{ warning.path }} — {{ warning.message }}
          </li>
        </ul>
      </div>

      <!-- Meta -->
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="tmcut-studio-name" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            {{ t('tmcut.videoTemplates.name') }}
          </label>
          <UInput id="tmcut-studio-name" v-model="editing.name" class="w-full" />
        </div>
        <div>
          <label for="tmcut-studio-topic" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            {{ t('tmcut.videoTemplates.topic') }}
          </label>
          <UInput id="tmcut-studio-topic" v-model="editing.topic" class="w-full" />
        </div>
        <div class="md:col-span-2">
          <label for="tmcut-studio-description" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            {{ t('tmcut.videoTemplates.description') }}
          </label>
          <UTextarea
            id="tmcut-studio-description"
            v-model="editing.description"
            :rows="2"
            class="w-full"
          />
        </div>
      </div>

      <!-- Input schema -->
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
              {{ t('tmcut.videoTemplates.inputs') }}
            </h3>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.videoTemplates.inputsHint') }}
            </p>
          </div>
          <UButton
            color="primary"
            variant="soft"
            size="xs"
            icon="i-lucide-plus"
            @click="addInput"
          >
            {{ t('tmcut.videoTemplates.addInput') }}
          </UButton>
        </div>
        <div class="space-y-2">
          <div
            v-for="field in editing.inputSchema"
            :key="field.id"
            class="grid grid-cols-12 gap-2 items-center"
          >
            <UInput
              v-model="field.id"
              name="template-field-id"
              :aria-label="t('tmcut.videoTemplates.inputId')"
              :placeholder="t('tmcut.videoTemplates.inputId')"
              class="col-span-3"
              size="sm"
            />
            <UInput
              v-model="field.label"
              name="template-field-label"
              :aria-label="t('tmcut.videoTemplates.inputLabel')"
              :placeholder="t('tmcut.videoTemplates.inputLabel')"
              class="col-span-4"
              size="sm"
            />
            <USelect
              v-model="field.type"
              :items="inputTypeItems()"
              :aria-label="t('tmcut.videoTemplates.inputType')"
              class="col-span-3"
              size="sm"
            />
            <div class="col-span-2 flex items-center justify-end gap-1">
              <USwitch
                :model-value="!!field.required"
                :aria-label="t('tmcut.videoTemplates.inputRequired')"
                size="xs"
                @update:model-value="(value: boolean) => { field.required = value }"
              />
              <UButton
                color="error"
                variant="ghost"
                icon="i-lucide-x"
                size="xs"
                @click="removeInput(field.id)"
              />
            </div>
          </div>
          <p
            v-if="editing.inputSchema.length === 0"
            class="text-xs text-neutral-400 dark:text-neutral-500"
          >
            {{ t('tmcut.videoTemplates.inputsEmpty') }}
          </p>
        </div>
      </div>

      <!-- Scenes -->
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
              {{ t('tmcut.videoTemplates.scenes') }}
            </h3>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.videoTemplates.scenesHint') }}
            </p>
          </div>
          <UButton
            color="primary"
            variant="soft"
            size="xs"
            icon="i-lucide-plus"
            @click="addScene"
          >
            {{ t('tmcut.videoTemplates.addScene') }}
          </UButton>
        </div>

        <div class="space-y-3">
          <div
            v-for="scene in editing.sceneBlueprints"
            :key="scene.id"
            class="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex flex-col gap-2"
          >
            <div class="flex items-center gap-2">
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ scene.order + 1 }}
              </UBadge>
              <UInput
                v-model="scene.id"
                name="template-scene-id"
                :aria-label="t('tmcut.videoTemplates.sceneId')"
                size="sm"
                class="w-40"
                :placeholder="t('tmcut.videoTemplates.sceneId')"
              />
              <USelect
                v-model="scene.role"
                :aria-label="t('tmcut.videoTemplates.sceneRole')"
                :items="roleItems()"
                size="sm"
                class="w-36"
              />
              <USelect
                v-model="scene.shotType"
                :aria-label="t('tmcut.videoTemplates.sceneShot')"
                :items="shotItems()"
                size="sm"
                class="w-40"
              />
              <div class="ml-auto flex items-center gap-1.5">
                <UInput
                  v-model.number="scene.durationTargetSec"
                  name="template-scene-duration"
                  :aria-label="t('tmcut.videoTemplates.sceneDuration')"
                  type="number"
                  size="sm"
                  class="w-24"
                  :placeholder="t('tmcut.videoTemplates.sceneDuration')"
                />
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  size="xs"
                  @click="removeScene(scene.id)"
                />
              </div>
            </div>
            <UInput
              v-model="scene.visualIntent"
              name="template-scene-visual"
              :aria-label="t('tmcut.videoTemplates.sceneVisual')"
              size="sm"
              :placeholder="t('tmcut.videoTemplates.sceneVisual')"
            />
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <UInput
                v-model="scene.onScreenText"
                name="template-scene-on-screen"
                :aria-label="t('tmcut.videoTemplates.sceneOnScreen')"
                size="sm"
                :placeholder="t('tmcut.videoTemplates.sceneOnScreen')"
              />
              <UInput
                v-model="scene.narration"
                name="template-scene-narration"
                :aria-label="t('tmcut.videoTemplates.sceneNarration')"
                size="sm"
                :placeholder="t('tmcut.videoTemplates.sceneNarration')"
              />
            </div>
          </div>
          <p
            v-if="editing.sceneBlueprints.length === 0"
            class="text-xs text-neutral-400 dark:text-neutral-500"
          >
            {{ t('tmcut.videoTemplates.scenesEmpty') }}
          </p>
        </div>
      </div>

      <!-- Prompt blocks -->
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
              {{ t('tmcut.videoTemplates.promptBlocks') }}
            </h3>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.videoTemplates.promptBlocksHint') }}
            </p>
          </div>
          <UButton
            color="primary"
            variant="soft"
            size="xs"
            icon="i-lucide-plus"
            @click="addPromptBlock"
          >
            {{ t('tmcut.videoTemplates.addPromptBlock') }}
          </UButton>
        </div>
        <div class="space-y-3">
          <div
            v-for="block in editing.promptBlocks"
            :key="block.id"
            class="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex flex-col gap-2"
          >
            <div class="flex items-center gap-2">
              <UInput
                v-model="block.id"
                name="template-block-id"
                :aria-label="t('tmcut.videoTemplates.blockId')"
                size="sm"
                class="w-44"
                :placeholder="t('tmcut.videoTemplates.blockId')"
              />
              <USelect
                v-model="block.type"
                :aria-label="t('tmcut.videoTemplates.blockTypeLabel')"
                :items="blockTypeItems()"
                size="sm"
                class="w-52"
              />
              <UButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                size="xs"
                class="ml-auto"
                @click="removePromptBlock(block.id)"
              />
            </div>
            <UTextarea
              v-model="block.content"
              name="template-block-content"
              :aria-label="t('tmcut.videoTemplates.blockContent')"
              :rows="2"
              size="sm"
              :placeholder="t('tmcut.videoTemplates.blockContent')"
            />
          </div>
          <p
            v-if="editing.promptBlocks.length === 0"
            class="text-xs text-neutral-400 dark:text-neutral-500"
          >
            {{ t('tmcut.videoTemplates.promptBlocksEmpty') }}
          </p>
        </div>
      </div>

      <!-- Test run -->
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
              {{ t('tmcut.videoTemplates.testRun') }}
            </h3>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.videoTemplates.testRunHint') }}
            </p>
          </div>
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-play"
            @click="runTest"
          >
            {{ t('tmcut.videoTemplates.runTest') }}
          </UButton>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <label
              v-for="field in editing.inputSchema"
              :key="field.id"
              class="block"
            >
              <span class="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                {{ field.label }}
                <span v-if="field.required" class="text-red-400">*</span>
              </span>
              <USwitch
                v-if="field.type === 'boolean'"
                :model-value="recordValue(field.id) === 'true'"
                :aria-label="field.label"
                size="sm"
                @update:model-value="(value: boolean) => setRecord(field.id, String(value))"
              />
              <UInput
                v-else
                name="template-record-value"
                :aria-label="field.label || field.id"
                :model-value="recordValue(field.id)"
                class="w-full"
                size="sm"
                @update:model-value="(value: string) => setRecord(field.id, value)"
              />
            </label>
            <p v-if="editing.inputSchema.length === 0" class="text-xs text-neutral-400 dark:text-neutral-500">
              {{ t('tmcut.videoTemplates.inputsEmpty') }}
            </p>
          </div>

          <div class="min-w-0">
            <div v-if="!testResult" class="border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg p-6 text-center">
              <UIcon name="i-lucide-flask-conical" class="size-6 mx-auto text-neutral-400 mb-1.5" />
              <p class="text-xs text-neutral-400 dark:text-neutral-500">
                {{ t('tmcut.videoTemplates.testEmpty') }}
              </p>
            </div>

            <div v-else class="space-y-3">
              <div
                class="rounded-lg border p-3"
                :class="testResult.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'"
              >
                <p class="text-xs font-semibold" :class="testResult.ok ? 'text-emerald-300' : 'text-red-300'">
                  {{ testResult.ok
                    ? t('tmcut.videoTemplates.testSummary', {
                      count: testResult.sceneCount ?? 0,
                      duration: testResult.durationSec ?? 0,
                      time: testRanAt
                    })
                    : t('tmcut.videoTemplates.testFailedSummary', { time: testRanAt })
                  }}
                </p>
                <ul v-if="!testResult.ok" class="mt-1.5 space-y-1 text-[11px] font-mono text-red-200/90 max-h-40 overflow-y-auto">
                  <li v-for="error in testResult.validation.errors" :key="error.path + error.code">
                    {{ error.path }} — {{ error.message }}
                  </li>
                </ul>
              </div>

              <div v-if="testResult.ok && testResult.storyboard" class="space-y-2 max-h-72 overflow-y-auto pr-1">
                <div
                  v-for="scene in testResult.storyboard"
                  :key="scene.sceneId"
                  class="border border-neutral-200 dark:border-neutral-800 rounded-lg p-2.5"
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <UBadge color="neutral" variant="subtle" size="xs">
                      {{ scene.order + 1 }}
                    </UBadge>
                    <span class="text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                      {{ tr(`tmcut.videoTemplates.roles.${scene.role}`, scene.role) }}
                    </span>
                    <span class="text-[11px] text-neutral-500">{{ scene.durationSec }}s</span>
                    <span v-if="scene.onScreenText" class="text-[11px] text-primary-400 truncate">
                      “{{ scene.onScreenText }}”
                    </span>
                  </div>
                  <p class="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-3">
                    {{ scene.prompt }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
