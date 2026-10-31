<script setup lang="ts">
const colorMode = useColorMode()
const { locale } = useI18n()

const color = computed(() => colorMode.value === 'dark' ? '#1b1718' : 'white')

const { fetchUser } = useAuth()
onMounted(async () => {
  await fetchUser()
})

useHead({
  titleTemplate: (titleChunk) => {
    if (!titleChunk) return 'TM Studio'
    if (titleChunk.endsWith('TM Studio')) return titleChunk
    return `${titleChunk} - TM Studio`
  },
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: locale
  }
})

const description = 'TM Studio - TMCut standalone video creation suite'

useSeoMeta({
  description,
  ogDescription: description
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
