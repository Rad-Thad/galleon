// The shape of acceptance.mjs, for the TypeScript that tests it.

export interface PlanStep {
  title: string
  place: string
  minutes: number
  text: string
}

export interface PlanItem {
  feature: string
  place: string
  minutes: number
  informational?: boolean
  passWhen?: string
  steps?: string[]
}

export interface Plan {
  places: { id: string; title: string }[]
  before: PlanStep[]
  after: PlanStep[]
  wholeSession: string
  items: PlanItem[]
}

/** A planned item that is in the script now, with the feature line it decides. */
export interface ReadyItem extends PlanItem {
  title: string
  line: string
}

export const SESSION_LIMIT_MINUTES: number
export function planErrors(plan: Plan, features: readonly Record<string, unknown>[]): string[]
export function readyItems(
  plan: Plan,
  features: readonly Record<string, unknown>[],
  progress: string
): ReadyItem[]
export function render(plan: Plan, items: readonly ReadyItem[], build: string): string
