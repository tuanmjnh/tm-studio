---
name: loading-button
description: Use when creating or editing forms, submit handlers, or buttons that trigger async work (create/edit/update/delete/save/login) in this Nuxt UI v4 project. Enforces always showing a loading state on the button AND adding a re-entrancy guard to prevent duplicate requests when the network is slow or the user double-clicks. Trigger keywords: loading, disable button, duplicate submit, double click, async form, isSubmitting, loading-auto.
---

# Loading Buttons & Duplicate-Submit Guard

Every async action button/form in this project must have BOTH:

1. A visible `loading` state on the button (spinner + auto-disable), AND
2. A guard at the top of the handler so the request can only run once.

This prevents duplicate create/update/delete requests when the network lags and the user clicks again.

## Non-negotiable rules

- A submit/action button that triggers `async` work MUST have `:loading="<state>"`. Never leave it without loading.
- The handler MUST start with `if (<state>.value) return` before setting `<state>.value = true`.
- Always reset the state in `finally`, never only on success.
- `loading-auto` is fine for one-off buttons (e.g. delete confirm), but for forms that reuse a submit handler prefer an explicit `ref(false)` so the guard can reuse it.

## Pattern (form page / modal)

```vue
<script setup lang="ts">
const saving = ref(false)

async function onSubmit() {
  if (saving.value) return          // re-entrancy guard — first line!
  saving.value = true
  try {
    await $fetch('/api/items', { method: 'POST', body: state })
    toast.add({ title: t('global.success'), color: 'success' })
  } catch (err: any) {
    toast.add({ title: err?.data?.message || err?.message || t('global.error'), color: 'error' })
  } finally {
    saving.value = false            // always reset
  }
}
</script>

<template>
  <UButton type="submit" :label="t('global.save')" :loading="saving" />
</template>
```

## Delete confirmation (ConfirmModal)

The shared `BaseConfirmModal` accepts `:loading`. Pass it from a `deleting` ref and guard the confirm handler:

```vue
<script setup lang="ts">
const deleting = ref(false)

async function doDelete() {
  if (deleting.value || !target.value) return
  deleting.value = true
  try {
    await $fetch(`/api/items?id=${target.value.id}`, { method: 'DELETE' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <LazyBaseConfirmModal v-model:open="showDelete" :loading="deleting" @confirm="doDelete" />
</template>
```

## Composables that perform requests (e.g. useAuth.login/register)

Same rule inside the composable: guard on the shared `loading` state so double submits cannot fire two requests.

```ts
async function login(credentials: LoginRequest) {
  if (loading.value) return
  loading.value = true
  try { /* ... */ } finally { loading.value = false }
}
```

## Checklist when touching any form

- [ ] Submit button has `:loading` bound to a ref.
- [ ] Handler's first line is `if (<state>.value) return`.
- [ ] `<state>.value = true` set right after the guard.
- [ ] `finally` resets `<state>.value = false`.
- [ ] Cancel/close buttons do not need loading, but should be disabled while saving if possible.
