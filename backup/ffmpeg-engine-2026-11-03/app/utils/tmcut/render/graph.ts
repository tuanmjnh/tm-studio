/**
 * RenderGraph: Graph representation for FFmpeg filter_complex chains and input sources.
 * Manages unique stream labels, filter nodes, and stream piping without collisions.
 */
export class RenderGraph {
  private inputs: string[] = []
  private inputFlags: string[][] = []
  private filterChains: string[] = []
  private labelCounters: Record<string, number> = {}

  /**
   * Adds an input source file to the FFmpeg graph and returns its index.
   * Optional `flags` (e.g. `-framerate 30 -loop 1 -t 10`) are emitted
   * immediately BEFORE `-i <file>` — required for looping still-image
   * backgrounds (Phase 4).
   */
  addInput(filePath: string, flags: string[] = []): number {
    this.inputs.push(filePath)
    this.inputFlags.push(flags)
    return this.inputs.length - 1
  }

  /**
   * Appends a raw filter chain to the graph.
   */
  addFilterChain(chain: string): void {
    if (chain && chain.trim()) {
      this.filterChains.push(chain.trim())
    }
  }

  /**
   * Generates a unique stream label like `[v_node_1]`.
   */
  nextLabel(prefix = 'v'): string {
    const nextIdx = (this.labelCounters[prefix] || 0) + 1
    this.labelCounters[prefix] = nextIdx
    return `[${prefix}_${nextIdx}]`
  }

  /**
   * Returns all registered input file paths.
   */
  getInputs(): string[] {
    return [...this.inputs]
  }

  /**
   * Builds the `-i <path>` command flags, emitting any per-input flags
   * (e.g. `-framerate 30 -loop 1 -t 10`) before their `-i`.
   */
  buildInputArgs(): string[] {
    const args: string[] = []
    for (let i = 0; i < this.inputs.length; i++) {
      args.push(...(this.inputFlags[i] ?? []))
      args.push('-i', this.inputs[i]!)
    }
    return args
  }

  /**
   * Returns the joined filter_complex argument string.
   */
  buildFilterComplex(): string {
    return this.filterChains.join('; ')
  }

  /**
   * Returns the array of raw filter chains.
   */
  getFilterChains(): string[] {
    return [...this.filterChains]
  }
}

/**
 * Converts a CSS hex color (#RRGGBB) into an FFmpeg color value (0xRRGGBB).
 */
export function ffmpegColor(color: string | undefined): string {
  if (!color) return 'black'
  const hex = color.replace('#', '')
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
    return `0x${hex}`
  }
  return color
}

/**
 * Decimal alpha for opacity<100 — short string, no float noise (11/100 → "0.11").
 */
export function opacityAlpha(opacityPct: number): string {
  return String(Number((Math.max(0, opacityPct) / 100).toFixed(4)))
}

/**
 * lut3d / font file argument escaping. Colons must be backslash-escaped in level-1 quotes.
 */
export function filterPathArg(filePath: string): string {
  if (filePath.includes('\'')) {
    throw new Error('File path cannot contain an apostrophe')
  }
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/**
 * Generates an FFmpeg lut3d filter string.
 */
export function lutFileFilter(filePath: string): string {
  return `lut3d=file='${filterPathArg(filePath)}'`
}
