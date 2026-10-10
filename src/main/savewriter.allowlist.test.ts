import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Nothing but `savewriter.ts` writes into an emulator's save tree.
 *
 * Read from the source rather than trusted to review: the Argosy fork's lesson
 * is that a guard added to one path is unfinished, and the next path is
 * usually added by somebody who never saw the first. So every module that
 * imports one of the filesystem's writing calls has to be named below with
 * where it writes, and a save module is never among them.
 */

const SRC = join(import.meta.dirname, '..')

/** The filesystem calls that create, replace or remove what is on disk. */
const WRITING = new Set([
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createWriteStream',
  'link',
  'linkSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync'
])

/** Every module allowed to write, and where — none of it a save tree. */
const ALLOWED: Record<string, string> = {
  'main/savewriter.ts': 'the save tree itself, and the backups beside the app root',
  'main/cores.ts': 'RetroArch cores in the emulators folder',
  'main/downloads.ts': 'a ROM download that was cancelled or failed',
  'main/fetchfile.ts': 'the staged file a caller names, which for a save is `stageBeside`',
  'main/install.ts': 'an installed game under the ROMs folder',
  'main/integrity.ts': 'a download that failed its digest',
  'main/library.ts': 'an uninstalled game under the ROMs folder',
  'main/log.ts': 'the log file',
  'main/offline.ts': 'the offline cache',
  'main/releases.ts': 'emulator releases in the emulators folder',
  'main/report.ts': 'a problem report',
  'main/romm/client.ts': 'firmware in the BIOS folder',
  'main/romm/transfer.ts': 'the staged file a caller names, which for a save is `stageBeside`',
  'main/root.ts': 'moving the app root',
  'main/store.ts': 'the settings file',
  'main/update.ts': 'the downloaded AppImage',
  'main/zip.ts': 'a staging folder or archive the caller names'
}

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) yield path
  }
}

/** The writing calls a module imports from `node:fs`, by name. */
function writingImports(source: string): string[] {
  const found: string[] = []
  for (const [, names] of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*'(?:node:)?fs(?:\/promises)?'/g
  )) {
    for (const name of names.split(',')) {
      const imported = name.trim().split(/\s+as\s+/)[0]
      if (WRITING.has(imported)) found.push(imported)
    }
  }
  // A whole-module import reaches every call, so it counts as all of them.
  if (/import\s+(?:\*\s+as\s+)?\w+\s+from\s*'(?:node:)?fs(?:\/promises)?'/.test(source)) {
    found.push('the whole fs module')
  }
  return found
}

function isSaveModule(path: string): boolean {
  return /^main\/(save[^/]*|ipc\/saves)\.ts$/.test(path)
}

const modules = [...sources(SRC)].map((path) => ({
  path: relative(SRC, path),
  source: readFileSync(path, 'utf8')
}))

describe('one writer into the save tree', () => {
  test('every module that writes to disk is on the allow-list', () => {
    const unlisted = modules
      .filter(({ path, source }) => writingImports(source).length > 0 && !(path in ALLOWED))
      .map(({ path, source }) => `${path}: ${writingImports(source).join(', ')}`)
    assert.deepEqual(unlisted, [])
  })

  test('no save module but the writer is allowed to write', () => {
    assert.deepEqual(
      Object.keys(ALLOWED).filter((path) => isSaveModule(path) && path !== 'main/savewriter.ts'),
      []
    )
  })

  test('no save module unpacks an archive itself', () => {
    const unpacking = modules
      .filter(({ path }) => isSaveModule(path) && path !== 'main/savewriter.ts')
      .filter(({ source }) => /\bextractZip\b/.test(source))
      .map(({ path }) => path)
    assert.deepEqual(unpacking, [])
  })

  test('the allow-list names no module that has stopped writing', () => {
    const stale = Object.keys(ALLOWED).filter((path) => {
      const module = modules.find((candidate) => candidate.path === path)
      return !module || writingImports(module.source).length === 0
    })
    assert.deepEqual(stale, [])
  })

  test('the scan sees named, renamed and whole-module imports', () => {
    assert.deepEqual(writingImports("import { rm, stat } from 'node:fs/promises'"), ['rm'])
    assert.deepEqual(writingImports("import { rename as move } from 'fs/promises'"), ['rename'])
    assert.deepEqual(writingImports("import * as fs from 'node:fs'"), ['the whole fs module'])
    assert.deepEqual(writingImports("import fs from 'node:fs'"), ['the whole fs module'])
    assert.deepEqual(writingImports("import { readFile } from 'node:fs/promises'"), [])
  })
})
