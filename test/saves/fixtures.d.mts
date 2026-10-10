// The shape of fixtures.mjs, for the TypeScript that tests and uses it.

export interface ZipEntry {
  name: string
  data: Buffer
}

export interface FixtureEntry {
  path: string
  system: string
  spec: string[]
  rom: string
  emulator: string
  note?: string
  localName?: string
  slot: 'autosave'
  uploadName: string
  shape: 'raw' | 'zip'
  bytes: number
  md5: string
  contentHash: string
  entries?: { name: string; bytes: number; md5: string }[]
}

export interface Fixture {
  bytes: Buffer
  entry: FixtureEntry
}

export const FIXTURES: string
export const MANIFEST: string
export const ARGOSY_MIN_UPLOAD: number
export function filler(seed: string, size: number): Buffer
export function zip(entries: ZipEntry[]): Buffer
export function contentHash(entries: ZipEntry[] | null, bytes: Buffer): string
export function buildFixtures(): Fixture[]
export function manifestText(fixtures: Fixture[]): string
export function filesUnder(root: string): string[]
export function differences(root?: string): string[]
export function writeFixtures(root?: string): number
