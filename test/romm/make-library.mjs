#!/usr/bin/env node
/**
 * Build the synthetic library Docker RomM scans (test/romm/library/, git-
 * ignored), in the shapes the owner's library has (docs/DEVICE-FACTS.md,
 * "Library shape"): multi-disc folders, cue/bin pairs RomM lists as separate
 * ROMs, PSP folders holding one image plus extras, an entry with no extension,
 * and zero-filled firmware stubs under the names emulators look for.
 *
 *   node test/romm/make-library.mjs [--out <dir>]
 *
 * Every file is a few hundred bytes derived from its own path, so the tree is
 * the same bytes on every run and on every machine, and nothing in it is a
 * real game or a real BIOS. The tree is rebuilt from scratch each time, so a
 * shape removed here cannot linger in a scan.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_OUT = join(here, 'library')

/**
 * Folder names are RomM's fs_slugs as the owner's server has them, which is
 * why PlayStation is `ps1` and Super Nintendo `SNES`.
 */
export const ROMS = [
  'roms/SNES/Galleon Test Cartridge (USA).sfc',
  'roms/gba/Galleon Test Handheld (Europe).gba',
  // Multi-disc: one folder, one image per disc; RomM reports has_multiple_files.
  'roms/ps1/Galleon Test Saga (USA)/Galleon Test Saga (USA) (Disc 1).chd',
  'roms/ps1/Galleon Test Saga (USA)/Galleon Test Saga (USA) (Disc 2).chd',
  'roms/ps1/Galleon Test Single (USA).chd',
  'roms/ngc/Galleon Test Two Discs (USA)/Galleon Test Two Discs (USA) (Disc 1).iso',
  'roms/ngc/Galleon Test Two Discs (USA)/Galleon Test Two Discs (USA) (Disc 2).iso',
  'roms/ngc/Galleon Test Cube (USA).iso',
  // A cue/bin pair at the top level, which RomM lists as two separate ROMs.
  'roms/ps2/Galleon Test Track (USA).cue',
  'roms/ps2/Galleon Test Track (USA).bin',
  'roms/ps2/Galleon Test Disc (USA).iso',
  // One image at the top of a folder, extras in subfolders below it:
  // has_nested_single_file. A second top-level file would make it multi-file.
  'roms/psp/Galleon Test Portable (USA)/Galleon Test Portable (USA).iso',
  'roms/psp/Galleon Test Portable (USA)/PSP/GAME/GTST00001/DLC.EDAT',
  'roms/psp/Galleon Test Portable (USA)/images/cover.png',
  'roms/psp/Galleon Test Plain (USA).iso',
  // The one entry on the owner's server with no extension.
  'roms/psp/Galleon Test No Extension',
  'roms/dc/Galleon Test Dream (USA).chd',
  'roms/dc/Galleon Test Dream Burn (USA).cdi'
]

/**
 * Firmware stubs: the file names emulators look for, every byte zero, so no
 * one could mistake them for the real thing.
 */
export const BIOS = [
  'bios/ps1/scph5501.bin',
  'bios/ps1/scph1001.bin',
  'bios/dc/dc_boot.bin',
  'bios/dc/dc_flash.bin',
  'bios/gba/gba_bios.bin',
  'bios/ps2/SCPH-70012_BIOS_V12_USA_200.BIN'
]

export const BIOS_STUB_BYTES = 1024

/**
 * A ROM's bytes: a line saying what it is, then filler from a hash of its
 * path. Deterministic, distinct per file (so checksums tell files apart) and
 * plainly not a game. The cue sheet is a real cue sheet, since a cue is read
 * as text.
 */
export function romBytes(path) {
  if (path.endsWith('.cue')) {
    const bin = path
      .split('/')
      .at(-1)
      .replace(/\.cue$/, '.bin')
    return Buffer.from(`FILE "${bin}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`)
  }
  const header = Buffer.from(`Galleon synthetic test file, not a game: ${path}\n`)
  const filler = []
  let block = createHash('sha256').update(path).digest()
  for (let i = 0; i < 8; i++) {
    filler.push(block)
    block = createHash('sha256').update(block).digest()
  }
  return Buffer.concat([header, ...filler])
}

/** Every file of the tree, path relative to the library root, with its bytes. */
export function libraryFiles() {
  return [
    ...ROMS.map((path) => ({ path, bytes: romBytes(path) })),
    ...BIOS.map((path) => ({ path, bytes: Buffer.alloc(BIOS_STUB_BYTES) }))
  ]
}

export function makeLibrary(out = DEFAULT_OUT) {
  rmSync(out, { recursive: true, force: true })
  const files = libraryFiles()
  for (const { path, bytes } of files) {
    const target = join(out, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  return files
}

/** `--out <dir>`, or the default beside this file. */
export function parseArgs(argv) {
  if (argv.length === 0) return { out: DEFAULT_OUT }
  if (argv.length === 2 && argv[0] === '--out') return { out: resolve(argv[1]) }
  throw new Error(`usage: make-library.mjs [--out <dir>], not: ${argv.join(' ')}`)
}

if (import.meta.main) {
  try {
    const { out } = parseArgs(process.argv.slice(2))
    const files = makeLibrary(out)
    console.log(`wrote ${files.length} files under ${out}`)
  } catch (error) {
    console.error(`make-library: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
