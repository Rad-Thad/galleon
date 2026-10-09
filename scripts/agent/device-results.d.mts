// The shape of device-results.mjs, for the TypeScript that tests it.

type Feature = Record<string, unknown>

interface Check {
  id: string
  result: string
  reason?: string | null
}

export interface Summary {
  status?: string
  checks?: Check[]
}

export interface IndexEntry {
  sha: string
  status?: string
  finishedAt?: string
}

export interface Analysis {
  fresh: { sha: string; status?: string; finishedAt?: string }[]
  safety: { sha: string; id: string; result: string; reason: string | null }[]
  regressions: { sha: string; id: string; result: string; features: string[] }[]
  newPasses: { sha: string; id: string; features: string[] }[]
  flips: { id: string; sha: string }[]
  reverts: {
    id: string
    sha: string
    checks: { id: string; result: string; reason: string | null }[]
  }[]
  changes: { id: string; passes: boolean }[]
  reports: string[]
  acceptance: string[]
  bridge: {
    lastSeen: string
    hours: number | null
    lastSkip: string | null
    version: number | null
  } | null
}

export function ingestedShas(progress: string): Set<string>
export function analyse(input: {
  features: readonly Feature[]
  index: readonly IndexEntry[]
  summaries: ReadonlyMap<string, Summary | null>
  progress: string
  reports?: readonly string[]
  acceptance?: readonly string[]
  status?: Record<string, unknown> | null
  now: string
  readyIsAncestor(id: string, sha: string): boolean
}): Analysis
export function render(analysis: Analysis): string
export function progressLines(analysis: Analysis): string[]
export function setPasses(text: string, id: string, passes: boolean): string
export function regressionTitle(subject: string): string
export function issuesToOpen(
  analysis: Analysis,
  openTitles: readonly string[]
): { title: string; labels: string[]; body: string }[]
export function readBranch(
  cwd: string,
  ref: string
): {
  index: IndexEntry[]
  status: Record<string, unknown> | null
  summaries: Map<string, Summary | null>
  reports: string[]
  acceptance: string[]
}
