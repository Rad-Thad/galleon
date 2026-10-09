// The shape of fetch-fixtures.mjs, for the TypeScript that tests it.

/** One manifest entry: a redistributable file, pinned, with its licence. */
export interface Fixture {
  path: string
  url: string
  sha256: string
  bytes: number
  licence: string
  attribution: string
}

export const DEFAULT_MANIFEST: string
export const DEFAULT_OUT: string
export const MAX_BYTES: number
export function sha256(bytes: Uint8Array): string
export function validateManifest(manifest: unknown): Fixture[]
export function loadManifest(path?: string): Fixture[]
export function fetchFixtures(
  files: readonly Fixture[],
  out?: string,
  options?: { fetch?: typeof fetch }
): Promise<{ path: string; status: 'kept' | 'fetched' }[]>
export function parseArgs(argv: readonly string[]): { out: string; manifest: string }
