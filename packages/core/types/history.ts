// TMCut history / command types (docs section 19).
// Commands are plain data + pure transitions so they stay serializable
// and testable outside any UI framework.

import type { TmcutTimeline } from './dsl.js'

export type TmcutCommandName
  = | 'add-clip'
    | 'delete-clip'
    | 'split-clip'
    | 'move-clip'
    | 'trim-clip'
    | 'set-speed'
    | 'set-transform'
    | 'set-effect'
    | 'set-keyframe'
    | 'add-transition'
    | 'set-canvas'
    | 'custom'

export interface TmcutCommand {
  name: TmcutCommandName
  label: string
  /** Timeline state before the command ran. */
  before: TmcutTimeline
  /** Timeline state after the command ran. */
  after: TmcutTimeline
  createdAt: string
}
