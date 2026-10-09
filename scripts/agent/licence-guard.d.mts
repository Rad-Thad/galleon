// The shape of licence-guard.mjs, for the TypeScript that tests it.

export interface RuntimeRow {
  version: string
  licence: string
  why: string
}

export interface Package {
  name: string
  version: string
  licence: string | null
}

export const FORK_POINT: readonly string[]
export const COPIED_MARKERS: readonly string[]
export function licenceAllowed(expression: unknown): boolean
export function licenceOf(manifest: Record<string, unknown>): string | null
export function runtimeRows(markdown: string): Map<string, RuntimeRow>
export function checkDirect(
  dependencies: Record<string, string> | undefined,
  rows: Map<string, RuntimeRow>
): string[]
export function checkTree(packages: readonly Package[]): string[]
export function scanned(path: string): boolean
export function checkCopied(files: readonly { path: string; text: string }[]): string[]
