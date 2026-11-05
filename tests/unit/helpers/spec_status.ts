/**
 * What a spec run actually proved.
 *
 * `run-all.mts` used to decide `PASS` from `res.status === 0` alone, so a spec
 * that printed `SKIP  …: no FFmpeg binary` and exited 0 was reported as a pass.
 * On a host without FFmpeg the suite said "119/119 specs passed" having
 * compared zero pixels. These three verdicts keep the difference visible:
 *
 *  - `PASS`    every check the spec can run on this host ran.
 *  - `PARTIAL` the spec finished its checks, but a gate inside it skipped.
 *  - `SKIP`    the spec bailed early — nothing it measures was measured.
 *
 * A non-zero exit outranks a skip line: a spec that skips and then fails is a
 * failure.
 */

export const SKIP = 'SKIP'
export const PARTIAL = 'PARTIAL'

export type SpecStatus = 'PASS' | 'PARTIAL' | 'SKIP' | 'FAIL'

export interface SpecCounts {
  passed: number
  skipped: number
  partial: number
  failed: number
  total: number
}

function lines(stdout: string): string[] {
  return stdout.split(/\r?\n/)
}

export function specStatus(exitCode: number | null, stdout: string): SpecStatus {
  if (exitCode !== 0) return 'FAIL'
  if (!lines(stdout).some(line => line.startsWith(SKIP))) return 'PASS'
  // A spec that ran to the end announces itself ("All N checks passed",
  // "name: N passed"). Without one, the skip was the whole run.
  return lines(stdout).some(line => line.includes('passed')) ? PARTIAL : SKIP
}

export function summarize(counts: SpecCounts): string {
  const { passed, skipped, partial, failed, total } = counts
  const head = `${passed}/${total} specs passed`
  if (skipped === 0 && partial === 0 && failed === 0) return head
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const notes: string[] = []
  if (skipped > 0) notes.push(plural(skipped, 'spec skipped'))
  if (partial > 0) notes.push(plural(partial, 'spec partial'))
  if (failed > 0) notes.push(plural(failed, 'spec failed'))
  return `${head}  (${notes.join(', ')})`
}
