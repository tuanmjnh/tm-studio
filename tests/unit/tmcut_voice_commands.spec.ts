/**
 * Voice/text command pipeline (roadmap v1 §4, P2).
 *
 * The planner is a CLOSED vocabulary: a spoken or typed sentence resolves to
 * one of the agent tools, the tool queues a draft operation, and the user
 * confirms. These checks pin the parts that do not need a microphone or an
 * LLM key:
 *  - a reversible command is STAGED, never applied on the spot;
 *  - confirming applies it as one undo group;
 *  - a second command will not silently join an existing draft;
 *  - read-only commands execute immediately;
 *  - unparseable input fails gracefully (keyword miss + no LLM key).
 */
import './helpers/tmcut_store_env'
import { useTmcutProject } from '../../app/composables/useTmcutProject'
import { useTmcutVoiceCommands } from '../../app/composables/useTmcutVoiceCommands'
import { useTmcutAgentTools } from '../../app/composables/useTmcutAgentTools'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const TICKS = 120000

function textItems(store: ReturnType<typeof useTmcutProject>) {
  return store.currentProject.value!.timeline.tracks.find(t => t.type === 'text')!.items || []
}

function videoItems(store: ReturnType<typeof useTmcutProject>) {
  return store.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items || []
}

async function main() {
  const store = useTmcutProject()
  const voice = useTmcutVoiceCommands()
  const agent = useTmcutAgentTools()

  store.createProject('voice-spec')

  await check('a typed reversible command is staged, not applied', async () => {
    agent.discardProposal()
    const before = textItems(store).length
    const res = await voice.runTextCommand('thêm phụ đề với nội dung xin chào', { language: 'vi' })
    if (!res.ok) throw new Error('command failed: ' + JSON.stringify(res.error))
    if (!res.staged) throw new Error('reversible command must be staged')
    if (res.queued !== 1) throw new Error('exactly one operation should be queued')
    if (textItems(store).length !== before) throw new Error('staging must not touch the timeline')
    const op = agent.pendingProposal.value!.operations[0]!
    if (op.tool !== 'timeline.add_caption') throw new Error(`wrong tool: ${op.tool}`)
    if (op.args.text !== 'xin chào') throw new Error(`wrong caption text: ${String(op.args.text)}`)
  })

  await check('confirming the draft applies it as one undo group', async () => {
    const before = textItems(store).length
    const applied = await voice.confirmStaged()
    if (!applied.ok) throw new Error('confirm failed: ' + JSON.stringify(applied.error))
    if (textItems(store).length !== before + 1) throw new Error('caption must land on the text track')
    store.undo()
    if (textItems(store).length !== before) throw new Error('one undo must remove the applied group')
    store.redo()
  })

  await check('a second command will not join a pending draft', async () => {
    agent.discardProposal()
    await voice.runTextCommand('thêm phụ đề với nội dung một', { language: 'vi' })
    const second = await voice.runTextCommand('thêm phụ đề với nội dung hai', { language: 'vi' })
    if (!second.ok) throw new Error('second command should report the pending draft, not fail hard')
    if (second.staged) throw new Error('second command must NOT be staged into the existing draft')
    if (second.queued !== 1) throw new Error('the pending draft must keep its single operation')
    if (agent.pendingProposal.value!.operations.length !== 1) throw new Error('draft was mutated by the second command')
    agent.discardProposal()
  })

  await check('a destructive-looking clip removal is reversible and staged', async () => {
    agent.discardProposal()
    store.addClipToTrack('video', { name: 'target', src: 'a.mp4', in: 0, out: 4 * TICKS, offset: 0 })
    const clipId = videoItems(store)[0]!.id
    store.selectClip(clipId)
    const staged = await voice.runTextCommand('xóa clip', { language: 'vi' })
    if (!staged.ok || !staged.staged) throw new Error('remove clip should stage (roadmap §4)')
    if (!videoItems(store).some(i => i.id === clipId)) throw new Error('clip must still exist before confirm')
    const applied = await voice.confirmStaged()
    if (!applied.ok) throw new Error('confirm failed')
    if (videoItems(store).some(i => i.id === clipId)) throw new Error('clip must be gone after confirm')
    store.undo()
    if (!videoItems(store).some(i => i.id === clipId)) throw new Error('undo must restore the clip')
  })

  await check('read-only commands run immediately and stage nothing', async () => {
    agent.discardProposal()
    const res = await voice.runTextCommand('thông tin dự án', { language: 'vi' })
    if (!res.ok) throw new Error('read command failed')
    if (res.staged) throw new Error('read command must not stage')
    const data = res.result as { projectId?: string }
    if (!data?.projectId) throw new Error('context result missing projectId')
    if (agent.proposalCount.value !== 0) throw new Error('read command must not queue operations')
  })

  await check('unparseable input fails gracefully without an LLM key', async () => {
    const res = await voice.runTextCommand('qqq zzz', { language: 'vi' })
    if (res.ok) throw new Error('nonsense must not succeed')
    if (res.error?.code !== 'no-intent') throw new Error(`expected no-intent, got ${res.error?.code}`)
  })

  console.log(`\n=== All ${passed} voice-command checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
