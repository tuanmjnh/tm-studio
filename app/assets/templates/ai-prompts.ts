// AI Template Prompt Examples for TMCut
// Use these prompts with the Template Designer (useTmcutAiTemplates)

export interface AiTemplatePrompt {
  category: 'intro' | 'promo' | 'outro' | 'minimal'
  name: string
  description: string
  prompt: string
}

export const AI_TEMPLATE_PROMPTS: AiTemplatePrompt[] = [
  {
    category: 'intro',
    name: 'Cinematic Logo Reveal',
    description: 'A dark, moody intro template with smooth text fade-in and subtle background animation placeholders.',
    prompt: 'Design a cinematic logo reveal template. Aspect ratio 16:9, category "intro". It should have a placeholder slot for a background video/texture, and a text slot in the center for the brand name, fading in after 1 second. Total duration: 5 seconds.'
  },
  {
    category: 'promo',
    name: 'Product Showcase - Split Screen',
    description: 'A modern, high-energy product showcase using split-screen to display two product features side-by-side.',
    prompt: 'Create a split-screen product showcase template, 16:9, category "promo". It should feature two video placeholder slots side-by-side, each with a text label below it. Duration: 15 seconds. Ensure space for title text at the top.'
  },
  {
    category: 'outro',
    name: 'Social Media Follow Call-to-Action',
    description: 'A clean outro screen with space for profile picture placeholder and social handle text.',
    prompt: 'Make an outro template for social media, 16:9, category "outro". Include a placeholder video/image slot for a profile picture, and two text slots below for social handles. Add a subtle background color or texture placeholder. Total duration: 10 seconds.'
  },
  {
    category: 'minimal',
    name: 'Clean Text Overlay',
    description: 'A simple, unobtrusive lower-third style text overlay for talking head videos.',
    prompt: 'Design a minimal text overlay template, 16:9, category "minimal". It needs a placeholder video slot for the main content, and a text slot in the lower third area for name and role. Duration: 20 seconds. Very simple and clean design.'
  }
];

// Usage example in Vue/Nuxt component:
/*
import { useTmcutAiTemplates } from '~/composables/useTmcutAiTemplates'
import { AI_TEMPLATE_PROMPTS } from '~/assets/templates/ai-prompts'

const { generateTemplate } = useTmcutAiTemplates()

function usePrompt(promptObj) {
  generateTemplate(promptObj.prompt)
}
*/
