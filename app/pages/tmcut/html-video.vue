<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TmcutButton, TmcutHtmlVideoStudio } from '#components'

const { t } = useI18n()
</script>

<template>
  <BasePage
    id="tmcut-html-video"
    :title="t('tmcut.htmlVideo.title')"
    :description="t('tmcut.htmlVideo.description')"
  >
    <template #right>
      <TmcutButton
        to="/tmcut/voice"
        icon="i-lucide-audio-lines"
        variant="soft"
        color="neutral"
        size="sm"
      >
        <span class="hidden sm:inline">{{ t('tmcut.voice.title') }}</span>
      </TmcutButton>
      <TmcutButton
        to="/tmcut"
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        size="sm"
      >
        <span class="hidden sm:inline">{{ t('tmcut.back') }}</span>
      </TmcutButton>
    </template>

    <TmcutHtmlVideoStudio embedded />
  </BasePage>
</template>
