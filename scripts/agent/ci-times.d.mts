// The shape of ci-times.mjs, for the TypeScript that tests it.

export interface CheckRun {
  name: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
}

export interface LegSummary {
  leg: string
  runs: number
  median: number | null
  over: boolean
}

export const LEGS: readonly string[]
export const TARGET_MINUTES: number
export const SAMPLE: number
export function median(values: readonly number[]): number | null
export function legTimes(checkRuns: readonly CheckRun[]): Record<string, number>
export function summarise(perCommit: readonly Record<string, number>[]): LegSummary[]
export function render(summary: readonly LegSummary[]): string
