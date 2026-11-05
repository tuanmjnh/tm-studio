/**
 * TMCut FFmpeg Compiler Facade
 *
 * Refactored in Round 70 (Roadmap R9) to the modular render/ graph architecture:
 * - render/types.ts: Core interfaces & options
 * - render/graph.ts: RenderGraph container & FFmpeg helpers
 * - render/text.ts: Drawtext & text overlay pipeline
 * - render/audio.ts: Audio fade & background audio pipeline
 * - render/video.ts: Video clip filters, effects, transitions & concatenation
 * - render/encoder.ts: Video/Audio codec args & GIF palette generator
 * - render/index.ts: Main compileTimelineToFfmpeg coordinator
 *
 * Re-exports everything for 100% backward compatibility.
 */

export * from './render'
