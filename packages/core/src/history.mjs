// =============================================================================
//  @tmcut/core — history
//  Command-pattern undo/redo over plain timeline snapshots (docs §19).
//  Commands are serializable data ({ name, label, before, after }), so the
//  same log can drive UI undo, AI rollback and crash recovery (docs §50).
// =============================================================================

function clone(value) {
  return structuredClone(value)
}

/**
 * Create a bounded undo/redo stack.
 * `commit(command)` records a completed mutation; `undo()` / `redo()`
 * return the timeline state to restore (or null when the stack is empty).
 */
export function createHistory(limit = 50) {
  const past = []
  const future = []
  const cap = Math.max(1, Math.floor(limit) || 50)

  return {
    get canUndo() {
      return past.length > 0
    },
    get canRedo() {
      return future.length > 0
    },
    get depth() {
      return past.length
    },
    commit(command) {
      if (!command || !command.before || !command.after) {
        throw new Error('history.commit requires { name, before, after }')
      }
      past.push({
        name: command.name ?? 'custom',
        label: command.label ?? command.name ?? 'custom',
        before: clone(command.before),
        after: clone(command.after),
        createdAt: new Date().toISOString()
      })
      if (past.length > cap) past.shift()
      future.length = 0
    },
    undo() {
      if (past.length === 0) return null
      const command = past.pop()
      future.push(command)
      return clone(command.before)
    },
    redo() {
      if (future.length === 0) return null
      const command = future.pop()
      past.push(command)
      return clone(command.after)
    },
    clear() {
      past.length = 0
      future.length = 0
    },
    // Internal accessors for coalesce/pushBatch (docs C15). Not part of
    // the regular undo/redo contract — callers should not rely on them.
    _top() {
      return past.length ? past[past.length - 1] : null
    },
    _replaceAfter(after) {
      if (past.length === 0) return
      past[past.length - 1].after = clone(after)
      future.length = 0 // a new edit invalidates redo, like commit
    }
  }
}

/**
 * Commit many mutations as ONE undo entry spanning first.before →
 * last.after (docs C15). Empty or single-entry lists degrade to a
 * regular commit.
 */
export function pushBatch(history, entries, label) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  if (list.length === 0) return
  const first = list[0]
  const last = list[list.length - 1]
  history.commit({
    name: first.name ?? 'batch',
    label: label ?? first.label ?? 'batch',
    before: first.before,
    after: last.after
  })
}

/**
 * Commit unless the top entry has the same name and was created less
 * than `windowMs` ago — then extend that entry's after-state in place
 * so a burst of edits (typing a text, dragging a slider) stays ONE
 * undo (docs C15). `windowMs` is wall-clock time on purpose: ticks are
 * media time and cannot measure typing pauses. Returns true when
 * coalesced, false when a new entry was committed.
 */
export function coalesce(history, entry, windowMs = 800) {
  if (!entry || !entry.before || !entry.after) {
    throw new Error('history.coalesce requires { name, before, after }')
  }
  const window = Number.isFinite(windowMs) ? Math.max(0, windowMs) : 800
  const name = entry.name ?? 'custom'
  const top = typeof history._top === 'function' ? history._top() : null
  const createdAt = top ? Date.parse(top.createdAt) : NaN
  if (top && top.name === name && Date.now() - createdAt <= window) {
    history._replaceAfter(entry.after)
    return true
  }
  history.commit(entry)
  return false
}
