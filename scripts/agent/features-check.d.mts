// The shape of features-check.mjs, for the TypeScript that tests it.

type Feature = Record<string, unknown>

/** What a pull request's flips are checked against; see `flipErrors`. */
export interface Evidence {
  progress: string
  summary(sha: string): { status?: string; checks?: { id: string; result: string }[] } | null
  acceptance(date: string): { items?: { feature: string; result: string }[] } | null
  readyIsAncestor(id: string, sha: string): boolean
}

export const REQUIRED_SOURCES: string[]
export function deviceChecks(feature: Feature): string[]
export function catalogueIds(markdown: string): string[]
export function caveatRows(markdown: string): { caveat: string; ids: string[] }[] | null
export function caveatErrors(
  rows: { caveat: string; ids: string[] }[] | null,
  features: readonly Record<string, unknown>[]
): string[]
export function validate(
  features: unknown,
  options: { catalogue: readonly string[]; required?: readonly string[] }
): string[]
export function compare(
  base: readonly Feature[],
  head: readonly Feature[]
): { errors: string[]; flipped: Feature[] }
export function flipErrors(flipped: readonly Feature[], evidence: Evidence): string[]
export function addedLines(before: string, after: string): string
export const FORBIDDEN_IN_GITHUB: string[]
export function forbiddenNames(files: readonly { path: string; text: string }[]): string[]
export const PROGRESS_GRACE_HOURS: number
export function progressEntryErrors(
  added: string,
  context: { opened: string; now: string; author?: string }
): string[]
export const SAFETY_CHECKS: string[]
export const COUNTING_STATUSES: string[]
export function readyIsAncestor(id: string, sha: string, cwd?: string): boolean
