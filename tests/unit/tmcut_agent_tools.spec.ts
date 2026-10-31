/**
 * Agent tool bridge (roadmap v1 §4, P1): the external-intelligence path must
 * behave like the manual editor — same store commands, a reviewed draft, and
 * ONE undo entry per applied proposal.
 *
 * These checks pin the contract that makes the Agent panel safe:
 *  - a mutating tool call NEVER changes the timeline (it only queues);
 *  - validation rejects stale ids with structured errors instead of no-ops;
 *  - "selected" resolves to the current selection;
 *  - applying a multi-op draft is a single Ctrl+Z;
 *  - a draft whose clip disappeared cannot be applied.
 */
import './helpers/tmcut_store_env'
import { useTmcutProject } from '../../app/composables/useTmcutProject'
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
  const agent = useTmcutAgentTools()

  await check('context read tools report the open project and timeline', async () => {
    store.createProject('agent-spec')
    const context = await agent.callTool('project.get_context')
    if (!context.ok) throw new Error('get_context failed')
    const data = context.data as { projectId: string, name: string }
    if (data.projectId !== store.currentProject.value!.id) throw new Error('wrong project id')
    const timeline = await agent.callTool('project.get_timeline')
    const snapshot = timeline.data as { tracks: unknown[] }
    if (snapshot.tracks.length < 3) throw new Error('timeline must list the default tracks')
  })

  await check('a mutating tool queues a draft and leaves the timeline untouched', async () => {
    agent.discardProposal()
    const before = textItems(store).length
    const res = await agent.callTool('timeline.add_caption', { text: 'Xin chào', atSec: 1, durationSec: 2 })
    if (!res.ok) throw new Error('add_caption should queue')
    if (textItems(store).length !== before) throw new Error('queueing must not mutate the timeline')
    if (agent.proposalCount.value !== 1) throw new Error('proposal count should be 1')
    const draft = agent.pendingProposal.value!
    if (draft.operations[0]!.tool !== 'timeline.add_caption') throw new Error('wrong queued tool')
  })

  await check('applying a multi-op draft is ONE undo step', async () => {
    agent.discardProposal()
    const before = textItems(store).length
    await agent.callTool('timeline.add_caption', { text: 'one', atSec: 0, durationSec: 2 })
    await agent.callTool('timeline.add_caption', { text: 'two', atSec: 3, durationSec: 2 })
    if (agent.proposalCount.value !== 2) throw new Error('two ops should be queued')
    const applied = agent.applyProposal()
    if (!applied.ok) throw new Error('apply failed: ' + JSON.stringify(applied.error))
    if (textItems(store).length !== before + 2) throw new Error('both captions must be on the timeline')
    if (agent.pendingProposal.value !== null) throw new Error('draft must clear after apply')
    store.undo()
    if (textItems(store).length !== before) throw new Error('one undo must remove BOTH captions')
    store.redo()
    if (textItems(store).length !== before + 2) throw new Error('redo must restore the whole group')
  })

  await check('validation rejects an unknown clip id with a structured error', async () => {
    agent.discardProposal()
    const res = await agent.callTool('timeline.remove_clip', { clipId: 'nope' })
    if (res.ok) throw new Error('unknown clip must be rejected')
    if (res.error?.code !== 'clip-not-found') throw new Error(`expected clip-not-found, got ${res.error?.code}`)
    if (agent.proposalCount.value !== 0) throw new Error('rejected ops must not be queued')
  })

  await check('the "selected" sentinel resolves to the current selection', async () => {
    agent.discardProposal()
    store.addClipToTrack('video', { name: 'pick-me', src: 'a.mp4', in: 0, out: 4 * TICKS, offset: 0 })
    const clipId = videoItems(store)[0]!.id
    store.selectClip(clipId)
    const queued = await agent.callTool('timeline.remove_clip', { clipId: 'selected' })
    if (!queued.ok) throw new Error('selected clip should resolve')
    const applied = agent.applyProposal()
    if (!applied.ok) throw new Error('apply failed')
    if (videoItems(store).some(i => i.id === clipId)) throw new Error('clip must be removed')
  })

  await check('a draft whose clip disappeared cannot be applied', async () => {
    agent.discardProposal()
    store.addClipToTrack('video', { name: 'doomed', src: 'b.mp4', in: 0, out: 4 * TICKS, offset: 0 })
    const clipId = videoItems(store)[0]!.id
    await agent.callTool('timeline.move_clip', { clipId, startSec: 2 })
    store.removeClip(clipId) // user deletes it in the UI while the draft waits
    const applied = agent.applyProposal()
    if (applied.ok) throw new Error('stale draft must not apply')
    if (applied.error?.code !== 'proposal-invalid') throw new Error(`expected proposal-invalid, got ${applied.error?.code}`)
    if (agent.proposalCount.value !== 1) throw new Error('the draft must stay for the user to discard')
  })

  await check('discard clears the draft without touching the timeline', async () => {
    agent.discardProposal()
    const before = textItems(store).length
    await agent.callTool('timeline.add_caption', { text: 'throwaway', atSec: 0, durationSec: 2 })
    const res = agent.discardProposal()
    if (!res.ok) throw new Error('discard failed')
    if (agent.proposalCount.value !== 0) throw new Error('draft must be empty')
    if (textItems(store).length !== before) throw new Error('discard must not mutate the timeline')
  })

  await check('a second proposal cannot silently join a pending draft', async () => {
    agent.discardProposal()
    await agent.callTool('timeline.add_caption', { text: 'first', atSec: 0, durationSec: 2 })
    const res = agent.createProposal('another request', 'voice')
    if (res.ok) throw new Error('create_proposal must refuse while a draft has operations')
    if (res.error?.code !== 'proposal-pending') throw new Error(`expected proposal-pending, got ${res.error?.code}`)
    agent.discardProposal()
  })

  await check('apply with an empty draft reports no-proposal', async () => {
    agent.discardProposal()
    const res = agent.applyProposal()
    if (res.ok) throw new Error('empty apply must fail')
    if (res.error?.code !== 'no-proposal') throw new Error(`expected no-proposal, got ${res.error?.code}`)
  })

  console.log(`\n=== All ${passed} agent-tool checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
