import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { byCodePoint, contentHashOf, entryName, READ_CHUNK_BYTES } from './savehash.ts'
import { bytesFor, hashCases, storedZip } from '../../test/saves/hashcases.mjs'
import { FIXTURES, MANIFEST } from '../../test/saves/fixtures.mjs'
import type { FixtureEntry } from '../../test/saves/fixtures.mjs'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-savehash-'))
  scratches.push(dir)
  return dir
}

function written(bytes: Buffer, name = 'save'): string {
  const path = join(scratch(), name)
  writeFileSync(path, bytes)
  return path
}

const md5 = (data: Buffer | string): string => createHash('md5').update(data).digest('hex')

/** SPEC.md section 4's zip hash, written out the long way. */
const linesHash = (lines: string[]): string => md5(Buffer.from(lines.join('\n'), 'utf8'))

const cases = hashCases()
const a = bytesFor('a', 3000)
const b = bytesFor('b', 1500)
const c = bytesFor('c', 700)
const ordinary = linesHash([`SAVE/a.bin:${md5(a)}`, `SAVE/b.bin:${md5(b)}`])

describe('a save that is not a zip', () => {
  test('is the md5 of its bytes', async () => {
    assert.equal(await contentHashOf(written(cases.plain)), md5(cases.plain))
  })

  test('even when it starts the way a zip does, since RomM looks for the end record', async () => {
    assert.equal(await contentHashOf(written(cases.zipSignatureOnly)), md5(cases.zipSignatureOnly))
  })

  test('and when it is shorter than an end record could be', async () => {
    assert.equal(await contentHashOf(written(Buffer.from('tiny'))), md5('tiny'))
  })

  test('a file that cannot be read has no hash', async () => {
    assert.equal(await contentHashOf(join(scratch(), 'missing')), null)
  })
})

describe('a zip', () => {
  test('is the md5 of its sorted name:md5 lines', async () => {
    assert.equal(await contentHashOf(written(cases.ordered)), ordinary)
  })

  test('whose entries come in another order hashes the same', async () => {
    assert.equal(await contentHashOf(written(cases.reordered)), ordinary)
  })

  test('ignores directory entries', async () => {
    assert.equal(await contentHashOf(written(cases.withDirectories)), ordinary)
  })

  test('with bytes in front of it, after it, or a comment, hashes as the zip it holds', async () => {
    for (const name of ['prefixed', 'trailing', 'commented'] as const) {
      assert.equal(await contentHashOf(written(cases[name])), ordinary, name)
    }
  })

  test('with no entries is the md5 of no lines', async () => {
    assert.equal(await contentHashOf(written(cases.emptyZip)), md5(''))
  })

  test('with a repeated name hashes the last entry of that name, twice', async () => {
    assert.equal(
      await contentHashOf(written(cases.repeatedName)),
      linesHash([`SAVE/a.bin:${md5(c)}`, `SAVE/a.bin:${md5(c)}`, `SAVE/b.bin:${md5(b)}`])
    )
  })

  test('names a legacy entry in code page 437', async () => {
    assert.equal(
      await contentHashOf(written(cases.legacyName)),
      linesHash([`S.bin:${md5(b)}`, `SÇß.bin:${md5(a)}`])
    )
  })

  test('sorts names by code point, as Python does', async () => {
    assert.equal(
      await contentHashOf(written(cases.astralName)),
      linesHash([`～.bin:${md5(b)}`, `\u{1F600}.bin:${md5(a)}`])
    )
  })

  test('with a damaged entry has no hash, as RomM stores none', async () => {
    assert.equal(await contentHashOf(written(cases.badChecksum)), null)
  })

  test('a raw save holding an end record it does not mean has no hash either', async () => {
    assert.equal(await contentHashOf(written(cases.endInRawSave)), null)
  })

  test('a compression method yauzl cannot read gives no hash rather than a wrong one', async () => {
    const zip = storedZip([{ name: 'SAVE/a.bin', data: a }])
    // Method 12, bzip2, in both headers.
    zip.writeUInt16LE(12, 8)
    zip.writeUInt16LE(12, 30 + 'SAVE/a.bin'.length + a.length + 10)
    assert.equal(await contentHashOf(written(zip)), null)
  })

  test('an encrypted entry gives no hash', async () => {
    const zip = storedZip([{ name: 'SAVE/a.bin', data: a }])
    zip.writeUInt16LE(zip.readUInt16LE(6) | 1, 6)
    zip.writeUInt16LE(zip.readUInt16LE(30 + 10 + a.length + 8) | 1, 30 + 10 + a.length + 8)
    assert.equal(await contentHashOf(written(zip)), null)
  })
})

test('every golden fixture hashes to the content_hash its manifest expects', async () => {
  const { fixtures } = JSON.parse(readFileSync(join(FIXTURES, MANIFEST), 'utf8')) as {
    fixtures: FixtureEntry[]
  }
  assert.ok(fixtures.length > 0)
  for (const fixture of fixtures) {
    assert.equal(
      await contentHashOf(join(FIXTURES, fixture.path)),
      fixture.contentHash,
      fixture.path
    )
  }
})

describe('memory', () => {
  const LIMIT = 8 * 1024 * 1024

  /** A file of `size` bytes that is mostly a hole, so the test writes little. */
  function sparse(size: number, head: Buffer, tail: Buffer): string {
    const path = join(scratch(), 'big')
    const fd = openSync(path, 'w')
    try {
      writeSync(fd, head, 0, head.length, 0)
      writeSync(fd, tail, 0, tail.length, size - tail.length)
    } finally {
      closeSync(fd)
    }
    return path
  }

  test('a large plain save is read in chunks, never more than 8 MB at once', async () => {
    const size = 24 * 1024 * 1024
    const path = sparse(size, Buffer.from('head'), Buffer.from('tail'))
    const reads: number[] = []
    const hash = await contentHashOf(path, (bytes) => reads.push(bytes))
    assert.equal(hash, md5(readFileSync(path)))
    assert.ok(Math.max(...reads) <= LIMIT, `largest read ${Math.max(...reads)}`)
    assert.ok(Math.max(...reads) <= Math.max(READ_CHUNK_BYTES, 0x10000 + 22))
    assert.ok(reads.reduce((sum, n) => sum + n, 0) >= size)
  })

  test('so is a zip holding a large entry', async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, 7)
    const path = written(storedZip([{ name: 'SAVE/big.bin', data: big }]), 'big.zip')
    const reads: number[] = []
    const hash = await contentHashOf(path, (bytes) => reads.push(bytes))
    assert.equal(hash, linesHash([`SAVE/big.bin:${md5(big)}`]))
    assert.ok(Math.max(...reads) <= LIMIT, `largest read ${Math.max(...reads)}`)
    assert.ok(reads.reduce((sum, n) => sum + n, 0) >= big.length)
  })
})

describe('entry names and their order', () => {
  test('a UTF-8 name that is not UTF-8 is an error, as it is in Python', () => {
    assert.throws(() =>
      entryName({ fileName: Buffer.from([0xff, 0xfe]), generalPurposeBitFlag: 0x800 })
    )
  })

  test('a name is cut at its first NUL', () => {
    assert.equal(
      entryName({ fileName: Buffer.from('a.bin\0junk'), generalPurposeBitFlag: 0 }),
      'a.bin'
    )
    assert.equal(entryName({ fileName: 'b.bin', generalPurposeBitFlag: 0x800 }), 'b.bin')
  })

  test('code point order puts astral characters after the rest of the BMP', () => {
    assert.ok(byCodePoint('\u{1F600}', '～') > 0)
    assert.ok(byCodePoint('a', 'ab') < 0)
    assert.equal(byCodePoint('same', 'same'), 0)
  })
})
