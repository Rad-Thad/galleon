// The shape of make-library.mjs, for the TypeScript that tests and uses it.

export const DEFAULT_OUT: string
export const ROMS: string[]
export const BIOS: string[]
export const BIOS_STUB_BYTES: number
export function romBytes(path: string): Buffer
export function libraryFiles(): { path: string; bytes: Buffer }[]
export function makeLibrary(out?: string): { path: string; bytes: Buffer }[]
export function parseArgs(argv: readonly string[]): { out: string }
