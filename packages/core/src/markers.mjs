// =============================================================================
//  @tmcut/core — markers
//  Pure marker operations on plain Timeline DSL v3 objects (docs Phase 2).
// =============================================================================

let markerCounter = 0

function nextMarkerId() {
  markerCounter += 1
  return `marker_${Date.now().toString(36)}${markerCounter.toString(36)}`
}

function markerList(timeline) {
  if (!timeline || !Array.isArray(timeline.markers)) {
    throw new Error('timeline.markers must be an array')
  }
  return timeline.markers
}

/** Add a marker at a tick position. Returns the marker. */
export function addMarker(timeline, atTicks, options = {}) {
  const marker = {
    id: options.id ?? nextMarkerId(),
    at: Math.max(0, Math.round(atTicks)),
    label: options.label,
    color: options.color ?? '#3b82f6'
  }
  markerList(timeline).push(marker)
  markerList(timeline).sort((a, b) => a.at - b.at)
  return marker
}

/** Remove a marker by id. Returns true when removed. */
export function removeMarker(timeline, markerId) {
  const markers = markerList(timeline)
  const index = markers.findIndex(m => m.id === markerId)
  if (index === -1) return false
  markers.splice(index, 1)
  return true
}

/** Move a marker. Returns false when missing. */
export function moveMarker(timeline, markerId, atTicks) {
  const marker = markerList(timeline).find(m => m.id === markerId)
  if (!marker) return false
  marker.at = Math.max(0, Math.round(atTicks))
  markerList(timeline).sort((a, b) => a.at - b.at)
  return true
}

/** Markers within [fromTicks, toTicks], sorted by position. */
export function markersInRange(timeline, fromTicks, toTicks) {
  const from = Math.min(fromTicks, toTicks)
  const to = Math.max(fromTicks, toTicks)
  return markerList(timeline)
    .filter(m => m.at >= from && m.at <= to)
    .slice()
    .sort((a, b) => a.at - b.at)
}
