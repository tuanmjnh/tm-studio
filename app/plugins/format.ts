import type { Directive } from 'vue'

export default defineNuxtPlugin((nuxtApp) => {
  const formatText: Directive = {
    mounted(el: any, binding: any) {
      const mode = binding.arg

      // --- Format function ---
      const transform = (value: string): string => {
        if (!value) return value
        switch (mode) {
          case 'upper':
            return value.toUpperCase()
          case 'lower':
            return value.toLowerCase()
          case 'words':
            // ✅ Unicode support (with accents)
            return value
              .toLocaleLowerCase()
              .split(/\s+/)
              .map(word =>
                word.charAt(0).toLocaleUpperCase() + word.slice(1)
              )
              .join(' ')
          case 'first':
            return value.charAt(0).toUpperCase() + value.slice(1)
          default:
            return value
        }
      }

      // --- Find the real input element ---
      const findInputElement = (root: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null => {
        if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
          return root
        }
        return (
          root.querySelector('input')
          || root.querySelector('textarea')
          || (root.shadowRoot?.querySelector('input') as HTMLInputElement | null)
          || (root.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | null)
        )
      }

      // --- Assign event ---
      const setupListeners = () => {
        const inputEl = findInputElement(el)
        if (!inputEl) return

        const handleInput = () => {
          const value = inputEl.value
          const formatted = transform(value)
          if (formatted !== value) {
            inputEl.value = formatted
            inputEl.dispatchEvent(new Event('input'))
          }
        }

        const handleBlur = () => {
          const trimmed = inputEl.value.trim()
          if (trimmed !== inputEl.value) {
            inputEl.value = trimmed
            inputEl.dispatchEvent(new Event('input'))
          }
        }

        inputEl.addEventListener('input', handleInput)
        inputEl.addEventListener('blur', handleBlur)
      }

      // Naive UI renders internal input a bit late → wait 1 tick
      if (el.querySelector('input') || el.querySelector('textarea')) {
        setupListeners()
      } else {
        setTimeout(setupListeners, 0)
      }
    }
  }
  nuxtApp.vueApp.directive('format-text', formatText)
})
