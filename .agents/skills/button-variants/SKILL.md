---
name: button-variants
description: Standard UButton variant conventions in Nuxt UI v4 (soft for primary/destructive, ghost for neutral/dismissal). Use when creating or styling buttons.
---

# Button Variants (Nuxt UI v4)

Standard variants for `UButton` in this project.

## Rules

- **Main / primary action** buttons (Save, Update, Create, Sign in, Confirm, Apply):
  use `variant="soft"` with `color="primary"`.
- **Cancel / close / dismiss** buttons:
  use `variant="ghost"` with `color="neutral"`.
- **Destructive** actions (Delete, Clear, Reset):
  use `variant="soft"` with `color="error"` (keep `subtle` only for batch-delete secondary buttons per AGENTS.md).
- Secondary/inline helpers (icon-only refresh, folder browse, edit):
  use `variant="ghost"` with `color="neutral"` (or a semantic color for its meaning).
- Never leave an action button with the default `solid` styling unless the design explicitly requires it.

## Examples

```vue
<!-- Primary action -->
<UButton type="submit" color="primary" variant="soft" :label="t('global.save')" :loading="saving" />

<!-- Cancel / close -->
<UButton color="neutral" variant="ghost" :label="t('global.cancel')" @click="showModal = false" />

<!-- Destructive -->
<UButton color="error" variant="soft" :label="t('global.delete')" @click="doDelete" />
```

## Checklist

- [ ] The submit/primary button uses `variant="soft"`.
- [ ] Cancel/close buttons use `variant="ghost"`.
- [ ] Combined with the loading-button skill: async actions have `:loading` + re-entrancy guard.
