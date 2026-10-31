<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TmcutButton, TmcutVoiceStudioBody } from '#components'

const { t } = useI18n()
</script>

<template>
  <BasePage
    id="tmcut-voice"
    :title="t('tmcut.voice.title')"
    :description="t('tmcut.voice.subtitle')"
  >
    <template #right>
      <TmcutButton
        to="/tmcut/html-video"
        icon="i-lucide-code-2"
        variant="soft"
        color="neutral"
        size="sm"
      >
        <span class="hidden sm:inline">{{ t('tmcut.htmlVideo.title') }}</span>
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

    <TmcutVoiceStudioBody embedded />
  </BasePage>
</template>
