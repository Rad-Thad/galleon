import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  BIOS,
  BIOS_STUB_BYTES,
  DEFAULT_OUT,
  ROMS,
  libraryFiles,
  makeLibrary,
  parseArgs,
  romBytes
} from './make-library.mjs'

function digestTree(root: string): string {
  const hash = createHash('sha256')
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, `${rel}${entry.name}/`)
      else hash.update(`${rel}${entry.name}\0`).update(readFileSync(path))
    }
  }
  walk(root, '')
  return hash.digest('hex')
}

test('the tree is the same bytes on every run, and stale files do not survive', () => {
  const a = mkdtempSync(join(tmpdir(), 'galleon-library-'))
  const b = mkdtempSync(join(tmpdir(), 'galleon-library-'))
  try {
    mkdirSync(join(a, 'roms/old'), { recursive: true })
    writeFileSync(join(a, 'roms/old/left-behind.bin'), 'x')
    makeLibrary(a)
    makeLibrary(b)
    assert.equal(digestTree(a), digestTree(b))
    assert.throws(() => readFileSync(join(a, 'roms/old/left-behind.bin')))
    assert.equal(libraryFiles().length, ROMS.length + BIOS.length)
  } finally {
    rmSync(a, { recursive: true, force: true })
    rmSync(b, { recursive: true, force: true })
  }
})

test('every ROM is distinct, small and says it is not a game', () => {
  const sums = new Set<string>()
  for (const path of ROMS) {
    const bytes = romBytes(path)
    assert.ok(bytes.length < 4096, path)
    sums.add(createHash('md5').update(bytes).digest('hex'))
    if (!path.endsWith('.cue')) assert.match(bytes.toString('latin1'), /not a game/)
  }
  assert.equal(sums.size, ROMS.length)
})

test('a cue sheet names the bin beside it', () => {
  const cue = ROMS.find((path) => path.endsWith('.cue'))
  assert.ok(cue)
  const bin = cue.replace(/\.cue$/, '.bin')
  assert.ok(ROMS.includes(bin))
  assert.match(
    romBytes(cue).toString(),
    new RegExp(`FILE "${bin.split('/').at(-1)?.replace(/[()]/g, '\\$&')}" BINARY`)
  )
})

test('firmware stubs are zero-filled and named as emulators expect', () => {
  for (const name of ['scph5501.bin', 'dc_boot.bin']) {
    assert.ok(
      BIOS.some((path) => path.endsWith(`/${name}`)),
      name
    )
  }
  for (const { path, bytes } of libraryFiles().filter((f) => f.path.startsWith('bios/'))) {
    assert.equal(bytes.length, BIOS_STUB_BYTES, path)
    assert.ok(
      bytes.every((byte) => byte === 0),
      path
    )
  }
})

test('the owner-shaped entries are all there', () => {
  const folders = (platform: string) =>
    new Set(
      ROMS.filter((p) => p.split('/').length > 3 && p.split('/')[1] === platform).map(
        (p) => p.split('/')[2]
      )
    )
  assert.equal(folders('ps1').size, 1)
  assert.equal(folders('ngc').size, 1)
  assert.equal(folders('psp').size, 1)
  assert.ok(ROMS.some((p) => p.startsWith('roms/psp/') && p.endsWith('.EDAT')))
  assert.ok(ROMS.some((p) => p.startsWith('roms/psp/') && !p.split('/').at(-1)?.includes('.')))
  assert.ok(ROMS.some((p) => p.startsWith('roms/dc/') && p.endsWith('.chd')))
  assert.ok(ROMS.some((p) => p.startsWith('roms/dc/') && p.endsWith('.cdi')))
})

test('arguments: none, or --out with a directory', () => {
  assert.deepEqual(parseArgs([]), { out: DEFAULT_OUT })
  assert.deepEqual(parseArgs(['--out', 'x']), { out: resolve('x') })
  assert.throws(() => parseArgs(['--out']), /usage/)
  assert.throws(() => parseArgs(['--nope', 'x']), /usage/)
})
