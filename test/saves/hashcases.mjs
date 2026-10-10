/**
 * Saves at the edges of `content_hash` (docs/save-sync/SPEC.md section 4):
 * the shapes where a reading of "is it a zip, and what is in it" that differs
 * from RomM's gives a different hash. `src/main/savehash.test.ts` holds the
 * app's hash to what each case means; `hash.real.ts` uploads every one to
 * Docker RomM 5.2.0 and holds the app's hash to the one the server stores.
 *
 * Synthetic bytes only, from a hash of the case's name.
 */
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'

/** Deterministic bytes, distinct per seed. */
export function bytesFor(seed, size) {
  const out = Buffer.alloc(size)
  let block = createHash('sha256').update(seed).digest()
  for (let at = 0; at < size; at += block.length) {
    block.copy(out, at)
    block = createHash('sha256').update(block).digest()
  }
  return out
}

const UTF8 = 0x0800

/**
 * A stored zip. Each entry: `name` (string, written as UTF-8 with the UTF-8
 * flag, or a Buffer written as is with no flag), `data`, and optionally `crc`
 * to write a wrong checksum.
 */
export function storedZip(entries, { comment = Buffer.alloc(0) } = {}) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.name)
    const name = raw ? entry.name : Buffer.from(entry.name, 'utf8')
    const flags = raw ? 0 : UTF8
    const crc = entry.crc ?? crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + entry.data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  return Buffer.concat([...locals, directory, end, comment])
}

const a = bytesFor('a', 3000)
const b = bytesFor('b', 1500)
const c = bytesFor('c', 700)

/** The cases, by name. Each is the bytes of one save file. */
export function hashCases() {
  const ordered = storedZip([
    { name: 'SAVE/a.bin', data: a },
    { name: 'SAVE/b.bin', data: b }
  ])
  const raw = bytesFor('raw save', 8192)
  const withEnd = Buffer.from(raw)
  // A raw save whose last bytes happen to hold an end-of-central-directory
  // signature: RomM calls it a zip, fails to read it, and stores no hash.
  Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(withEnd, withEnd.length - 40)
  const leading = Buffer.from(raw)
  // Starts like a zip, which is Argosy's test, but has no end record.
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(leading, 0)
  return {
    plain: raw,
    ordered,
    reordered: storedZip([
      { name: 'SAVE/b.bin', data: b },
      { name: 'SAVE/a.bin', data: a }
    ]),
    withDirectories: storedZip([
      { name: 'SAVE/', data: Buffer.alloc(0) },
      { name: 'SAVE/b.bin', data: b },
      { name: 'SAVE/a.bin', data: a }
    ]),
    prefixed: Buffer.concat([bytesFor('prefix', 512), ordered]),
    trailing: Buffer.concat([ordered, bytesFor('trailing', 100)]),
    commented: storedZip(
      [
        { name: 'SAVE/a.bin', data: a },
        { name: 'SAVE/b.bin', data: b }
      ],
      { comment: Buffer.from('a comment after the record') }
    ),
    endInRawSave: withEnd,
    zipSignatureOnly: leading,
    badChecksum: storedZip([
      { name: 'SAVE/a.bin', data: a, crc: 1 },
      { name: 'SAVE/b.bin', data: b }
    ]),
    repeatedName: storedZip([
      { name: 'SAVE/a.bin', data: a },
      { name: 'SAVE/a.bin', data: c },
      { name: 'SAVE/b.bin', data: b }
    ]),
    // 0x80 and 0xE1 are Ç and ß in code page 437, which Python decodes a name
    // with when the entry does not say UTF-8.
    legacyName: storedZip([
      { name: Buffer.from([0x53, 0x80, 0xe1, 0x2e, 0x62, 0x69, 0x6e]), data: a },
      { name: 'S.bin', data: b }
    ]),
    // UTF-16 puts U+1F600 before U+FF5E; Python's order, by code point, does not.
    astralName: storedZip([
      { name: '\u{1F600}.bin', data: a },
      { name: '～.bin', data: b }
    ]),
    emptyZip: storedZip([])
  }
}
