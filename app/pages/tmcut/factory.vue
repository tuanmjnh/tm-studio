<template>
  <!-- BasePage is mandatory (AGENTS.md): without it the page had no navbar
       chrome, no document title, and its content sat directly in the dashboard
       flex row — so the batch console collapsed to ~1250px and the back link
       floated at the far right of the window. -->
  <BasePage
    id="tmcut-factory"
    :title="t('tmcut.videoTemplates.tabFactory')"
    :description="t('tmcut.factory.newBatchDesc')"
  >
    <template #right>
      <TmcutButton
        to="/tmcut/templates"
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        size="sm"
      >
        {{ t('tmcut.factory.backToTemplates') }}
      </TmcutButton>
    </template>

    <TmcutVideoFactory />
  </BasePage>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TmcutVideoFactory } from '#components'

const { t } = useI18n()
</script>
