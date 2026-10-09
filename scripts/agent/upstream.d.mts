// The shape of upstream.mjs, for the TypeScript that tests it.

export interface Compare {
  html_url?: string
  total_commits?: number
  commits?: {
    sha: string
    html_url: string
    commit?: { message?: string; author?: { date?: string } }
  }[]
}

export interface Issue {
  number: number
  title: string
  body?: string | null
  state: string
  pull_request?: unknown
}

export type Step =
  | { action: 'none' }
  | { action: 'update'; number: number; title: string; body: string }
  | { action: 'open'; title: string; body: string; labels: string[] }

export const UPSTREAM: string
export const LABEL: string
export function baseSha(markdown: string): string | null
export function title(count: number): string
export function body(base: string, compare: Compare): string
export function existing(issues: readonly Issue[]): Issue | null
export function plan(base: string, compare: Compare, issues: readonly Issue[]): Step
export function run(options: {
  repo: string
  base: string
  request(method: string, path: string, body?: unknown): Promise<unknown>
}): Promise<Step>
