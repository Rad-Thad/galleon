// The shape of next.mjs, for the TypeScript that tests it.

/** A feature a session may pick up, and the gate holding it back, if one is. */
export interface Eligible {
  id: string
  title: string
  verification: string
  blockedBy: string | null
}

export function eligible(features: readonly Record<string, unknown>[]): Eligible[]
export function render(list: readonly Eligible[]): string
