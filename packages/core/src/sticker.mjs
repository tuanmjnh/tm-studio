// @tmcut-core — sticker catalog (R124 A6, CapCut §3.4).
//
// Stickers are UNICODE EMOJI inserted as text-track graphic layers: the
// preview renders them through the browser's emoji font, the export draws
// them through the existing drawtext chain (a documented v1 fidelity gap:
// drawtext/freetype yields monochrome glyphs while the browser shows the
// color artwork; geometry, position, keyframes, masks and animations are
// exact). The catalog lives here so the panel, the tests and future
// remote sticker packs share one source of truth.
//
// CURATED, not exhaustive: the CapCut-style grid shows the icons people
// actually put on video, grouped the way the picker's category chips do.
// `id` keys feed i18n labels (`tmcut.stickers.groups.<id>`); `emojis` are
// plain strings — click inserts one as a clip.

/** Picker categories, each with its sticker set (order = chip order). */
export const STICKER_GROUPS = [
  {
    id: 'faces',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉',
      '😊', '😍', '🥰', '😘', '😜', '🤪', '🤨', '🧐', '🤓', '😎',
      '🥳', '😏', '😌', '😴', '🤤', '🤑', '🤗', '🤔', '🤫', '😐',
      '😶', '😬', '🙄', '😯', '😑', '🥱', '😪', '😮', '🤐', '😔',
      '😕', '😖', '😒', '🙃', '🤡', '😩', '😢', '😭', '😤', '😡'
    ]
  },
  {
    id: 'gestures',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
      '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏',
      '💪', '🦾', '👏', '🙌', '👐', '🤲', '✍️', '💅', '🤳', '🫶'
    ]
  },
  {
    id: 'hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'
    ]
  },
  {
    id: 'animals',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦆', '🦅',
      '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌'
    ]
  },
  {
    id: 'objects',
    emojis: [
      '🔥', '⭐', '🌟', '✨', '⚡', '💥', '💫', '🎉', '🎊', '🎈',
      '🎁', '🏆', '🥇', '🎯', '🎮', '💡', '💰', '💎', '🚀', '✈️',
      '📱', '💻', '🎧', '📷', '🎬', '🎤', '🎵', '🔔', '⏰', '✅'
    ]
  },
  {
    id: 'symbols',
    emojis: [
      '💯', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '⬛',
      '▶️', '⏸️', '⏹️', '⏩', '🔁', '🔊', '📢', '📣', '🗨️', '💬'
    ]
  }
]

/** Flat list of every catalog emoji (search fallback / count tests). */
export function allStickers() {
  return STICKER_GROUPS.flatMap(g => g.emojis)
}

/** Case-insensitive contains, Unicode-aware (search box helper). */
export function stickerMatches(query, emoji) {
  if (!query) return true
  return String(emoji).toLowerCase().includes(String(query).toLowerCase())
}
