import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_TEMPLATES,
  getBuiltinTemplates,
  getTemplateById,
  validateTemplate,
  filterTemplates,
  createTemplateFromTimeline,
  instantiateTemplate,
  replacePlaceholder,
  INDUSTRY_CATALOG,
  TICKS_PER_SECOND
} from '../src/index.mjs'

test('templates: built-in templates integrity and validation', () => {
  assert.ok(Array.isArray(BUILTIN_TEMPLATES), 'BUILTIN_TEMPLATES is an array')
  assert.ok(BUILTIN_TEMPLATES.length >= 6, 'Contains at least 6 built-in templates')

  for (const tpl of BUILTIN_TEMPLATES) {
    const res = validateTemplate(tpl)
    assert.equal(res.valid, true, `Template ${tpl.id} is valid: ${res.errors.join(', ')}`)
    assert.ok(tpl.durationTicks > 0, `Template ${tpl.id} has positive durationTicks`)
    assert.ok(tpl.tracks.length > 0, `Template ${tpl.id} has at least one track`)
    assert.ok(Array.isArray(tpl.placeholders), `Template ${tpl.id} has placeholders array`)
    assert.equal(tpl.isBuiltin, true, `Template ${tpl.id} is marked as builtin`)
  }
})

test('templates: getBuiltinTemplates returns isolated deep clone', () => {
  const list = getBuiltinTemplates()
  assert.equal(list.length, BUILTIN_TEMPLATES.length)
  // Mutating cloned template must not mutate source
  list[0].name = 'MUTATED_NAME'
  assert.notEqual(BUILTIN_TEMPLATES[0].name, 'MUTATED_NAME')
})

test('templates: getTemplateById retrieves matching template', () => {
  const found = getTemplateById(BUILTIN_TEMPLATES, 'tpl-tiktok-hook-intro')
  assert.ok(found)
  assert.equal(found.id, 'tpl-tiktok-hook-intro')

  const notFound = getTemplateById(BUILTIN_TEMPLATES, 'non-existent-id')
  assert.equal(notFound, null)
})

test('templates: filterTemplates filters by category, aspect, and search query', () => {
  const introOnly = filterTemplates(BUILTIN_TEMPLATES, { category: 'intro' })
  assert.ok(introOnly.length >= 2)
  assert.ok(introOnly.every(t => t.category === 'intro'))

  const verticalOnly = filterTemplates(BUILTIN_TEMPLATES, { aspectRatio: '9:16' })
  assert.ok(verticalOnly.length >= 2)
  assert.ok(verticalOnly.every(t => t.aspectRatio === '9:16'))

  const searchResults = filterTemplates(BUILTIN_TEMPLATES, { search: 'cinematic' })
  assert.ok(searchResults.length >= 1)
  assert.equal(searchResults[0].id, 'tpl-youtube-cinematic-intro')

  const combined = filterTemplates(BUILTIN_TEMPLATES, {
    category: 'intro',
    aspectRatio: '9:16',
    search: 'tiktok'
  })
  assert.equal(combined.length, 1)
  assert.equal(combined[0].id, 'tpl-tiktok-hook-intro')
})

test('templates: validateTemplate identifies missing or malformed fields', () => {
  assert.equal(validateTemplate(null).valid, false)
  assert.equal(validateTemplate({}).valid, false)

  const missingName = {
    id: 't-1',
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationTicks: 1000,
    tracks: []
  }
  const res1 = validateTemplate(missingName)
  assert.equal(res1.valid, false)
  assert.ok(res1.errors.some(e => e.includes('name')))

  const invalidCanvas = {
    id: 't-2',
    name: 'Sample',
    canvas: { width: -100, height: 1080, fps: 30 },
    durationTicks: 1000,
    tracks: []
  }
  const res2 = validateTemplate(invalidCanvas)
  assert.equal(res2.valid, false)
  assert.ok(res2.errors.some(e => e.includes('width')))
})

test('templates: createTemplateFromTimeline extracts template with auto placeholders', () => {
  const dummyTimeline = {
    tracks: [
      {
        id: 'track-v1',
        type: 'video',
        name: 'Video',
        items: [
          { id: 'c1', name: 'Intro Clip', in: 0, out: 4 * TICKS_PER_SECOND, offset: 0, speed: 1, src: 'media/test.mp4' }
        ]
      },
      {
        id: 'track-t1',
        type: 'text',
        name: 'Text',
        items: [
          { id: 'c2', name: 'Welcome', text: 'HELLO WORLD', in: 0, out: 3 * TICKS_PER_SECOND, offset: 0, speed: 1 }
        ]
      }
    ],
    markers: []
  }

  const tpl = createTemplateFromTimeline(dummyTimeline, {
    name: 'My Custom Vlog Opener',
    category: 'intro',
    aspectRatio: '16:9'
  })

  assert.equal(tpl.name, 'My Custom Vlog Opener')
  assert.equal(tpl.category, 'intro')
  assert.equal(tpl.aspectRatio, '16:9')
  assert.equal(tpl.durationTicks, 4 * TICKS_PER_SECOND)
  assert.equal(tpl.placeholders.length, 2)
  assert.equal(tpl.isBuiltin, false)
})

test('templates: instantiateTemplate generates unique IDs and applies replacements', () => {
  const sourceTpl = BUILTIN_TEMPLATES[0] // tiktok-hook-intro
  const oldClipIds = new Set()
  for (const trk of sourceTpl.tracks) {
    for (const it of trk.items) oldClipIds.add(it.id)
  }

  const instantiated = instantiateTemplate(sourceTpl, {
    replacements: {
      'ph-hook-video': { src: 'd:/videos/my_cat.mp4', name: 'My Cat Video' },
      'ph-hook-headline': { text: 'LOOK AT THIS CAT! 🐱' }
    }
  })

  assert.ok(instantiated.timeline)
  assert.ok(instantiated.timeline.tracks.length > 0)
  assert.equal(instantiated.durationMs, 3000)

  // Verify IDs are all new and distinct from source template
  const newClipIds = new Set()
  let replacedVideoFound = false
  let replacedTextFound = false

  for (const trk of instantiated.timeline.tracks) {
    for (const it of trk.items) {
      assert.equal(oldClipIds.has(it.id), false, `Clip ID ${it.id} must be freshly generated`)
      newClipIds.add(it.id)

      if (it.src === 'd:/videos/my_cat.mp4') {
        replacedVideoFound = true
        assert.equal(it.name, 'My Cat Video')
      }
      if (it.text === 'LOOK AT THIS CAT! 🐱') {
        replacedTextFound = true
      }
    }
  }

  assert.equal(replacedVideoFound, true, 'Replacement video src was applied')
  assert.equal(replacedTextFound, true, 'Replacement text was applied')
})

test('templates: replacePlaceholder updates target clip in place', () => {
  const timeline = {
    tracks: [
      {
        id: 't-1',
        type: 'video',
        items: [
          { id: 'clip-target', src: '', name: 'Empty Placeholder', text: undefined }
        ]
      }
    ]
  }

  const success = replacePlaceholder(timeline, 'clip-target', {
    src: 'd:/assets/sample.mp4',
    name: 'Real Footage'
  })

  assert.equal(success, true)
  assert.equal(timeline.tracks[0].items[0].src, 'd:/assets/sample.mp4')
  assert.equal(timeline.tracks[0].items[0].name, 'Real Footage')

  const failed = replacePlaceholder(timeline, 'non-existent', { src: 'x' })
  assert.equal(failed, false)
})

// =============================================================================
//  Industry pack invariants
//  Every shipped card must be a usable timeline, not decorative data: the
//  tests below check the wiring (placeholders → clips), the geometry (nothing
//  scheduled past the template's own end, nothing laid out off-canvas) and the
//  filter contract the library UI depends on.
// =============================================================================

test('templates: industry pack covers the catalog without duplicate ids', () => {
  const ids = BUILTIN_TEMPLATES.map(t => t.id)
  assert.equal(new Set(ids).size, ids.length, 'template ids are unique')

  const known = new Set(INDUSTRY_CATALOG.map(i => i.id))
  for (const tpl of BUILTIN_TEMPLATES) {
    assert.ok(known.has(tpl.industry), `${tpl.id} has a known industry (${tpl.industry})`)
  }

  for (const industry of INDUSTRY_CATALOG) {
    if (industry.id === 'general') continue
    const count = BUILTIN_TEMPLATES.filter(t => t.industry === industry.id).length
    assert.ok(count >= 1, `industry "${industry.id}" ships at least one template`)
  }

  assert.ok(BUILTIN_TEMPLATES.length >= 24, 'pack ships a full industry set')
})

test('templates: every placeholder resolves to a real clip on its track', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    const trackById = new Map(tpl.tracks.map(trk => [trk.id, trk]))
    const placeholderIds = new Set()

    for (const ph of tpl.placeholders) {
      assert.equal(placeholderIds.has(ph.id), false, `${tpl.id}: placeholder id ${ph.id} is unique`)
      placeholderIds.add(ph.id)

      const track = trackById.get(ph.trackId)
      assert.ok(track, `${tpl.id}: placeholder ${ph.id} points at an existing track`)
      const clip = (track.items || []).find(item => item.id === ph.clipId)
      assert.ok(clip, `${tpl.id}: placeholder ${ph.id} points at a clip on that track`)
      assert.equal(clip.type, track.type, `${tpl.id}: ${ph.clipId} type matches its track`)

      if (ph.type === 'text') {
        assert.equal(clip.text, ph.defaultContent, `${tpl.id}: ${ph.id} defaultContent mirrors the clip text`)
      }
    }

    assert.ok(tpl.placeholders.some(p => p.required), `${tpl.id} marks at least one required slot`)
    assert.ok(
      tpl.placeholders.some(p => p.type === 'video' || p.type === 'image'),
      `${tpl.id} has a media slot to drop footage into`
    )
  }
})

test('templates: clip geometry stays inside the template and the canvas', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    const { width: W, height: H } = tpl.canvas
    assert.equal(tpl.durationTicks % 1, 0, `${tpl.id}: duration is whole ticks`)

    for (const track of tpl.tracks) {
      for (const item of track.items) {
        const label = `${tpl.id}/${item.id}`
        assert.ok(item.in >= 0, `${label}: in >= 0`)
        assert.ok(item.out > item.in, `${label}: out > in`)
        assert.ok(item.out <= tpl.durationTicks, `${label}: out within duration`)
        assert.ok(item.offset >= 0, `${label}: offset >= 0`)
        assert.ok(
          item.offset + (item.out - item.in) <= tpl.durationTicks,
          `${label}: scheduled end within duration`
        )

        if (item.type === 'text') {
          assert.ok(typeof item.text === 'string' && item.text.trim().length > 0, `${label}: has copy`)
          assert.ok(item.fontSize >= 16 && item.fontSize <= H / 4, `${label}: readable font size`)
          assert.ok(Math.abs(item.x) <= W / 2, `${label}: x inside canvas`)
          assert.ok(Math.abs(item.y) <= H / 2, `${label}: y inside canvas`)
        }
      }
    }
  }
})

test('templates: canvas matches the advertised aspect ratio', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    const ratio = tpl.canvas.width / tpl.canvas.height
    const expected = tpl.aspectRatio === '9:16' ? 9 / 16 : tpl.aspectRatio === '16:9' ? 16 / 9 : 1
    assert.ok(Math.abs(ratio - expected) < 0.01, `${tpl.id}: ${tpl.aspectRatio} canvas is ${tpl.canvas.width}x${tpl.canvas.height}`)
  }
})

test('templates: every builtin instantiates and applies its own placeholder copy', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    const title = tpl.placeholders.find(p => p.type === 'text')
    assert.ok(title, `${tpl.id} has a text slot`)

    const marker = `REPLACED ${tpl.id}`
    const out = instantiateTemplate(tpl, { replacements: { [title.id]: { text: marker } } })

    assert.ok(out.timeline.tracks.length === tpl.tracks.length, `${tpl.id}: tracks survive instantiation`)
    const texts = out.timeline.tracks.flatMap(trk => trk.items).map(item => item.text).filter(Boolean)
    assert.ok(texts.includes(marker), `${tpl.id}: replacement reaches the clip`)
    assert.equal(out.durationMs, Math.round((tpl.durationTicks / TICKS_PER_SECOND) * 1000), `${tpl.id}: durationMs round-trips`)
  }
})

test('templates: search and industry filters find the industry cards', () => {
  const fnb = filterTemplates(BUILTIN_TEMPLATES, { industry: 'fnb' })
  assert.ok(fnb.length >= 2)
  assert.ok(fnb.every(t => t.industry === 'fnb'))

  const byTag = filterTemplates(BUILTIN_TEMPLATES, { search: 'quán ăn' })
  assert.ok(byTag.some(t => t.industry === 'fnb'), 'Vietnamese tag finds the F&B cards')

  const byIndustryLabel = filterTemplates(BUILTIN_TEMPLATES, { search: 'real estate' })
  assert.ok(byIndustryLabel.every(t => t.industry === 'realestate'))

  const combined = filterTemplates(BUILTIN_TEMPLATES, { industry: 'beauty', aspectRatio: '16:9' })
  assert.ok(combined.every(t => t.industry === 'beauty' && t.aspectRatio === '16:9'))
})
