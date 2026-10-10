/**
 * The golden save fixtures: synthetic saves in exactly the shapes Argosy
 * uploads to RomM 5.2.0, built from docs/save-sync/SPEC.md (M2-03). Nothing
 * here comes from Argosy's code or from anyone's real saves: every byte is a
 * header the spec's format names, or filler from a hash of the fixture's name.
 *
 *   node test/saves/fixtures.mjs           # fail if test/fixtures/saves differs
 *   node test/saves/fixtures.mjs --write   # rewrite test/fixtures/saves
 *
 * The bytes are committed, so a change to this file that changes a fixture
 * shows up as a changed binary in review, and the round-trip harness reads the
 * files rather than trusting this builder.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = resolve(here, '../fixtures/saves')
export const MANIFEST = 'manifest.json'

/** Argosy never uploads a save this small or smaller (SPEC.md section 3). */
export const ARGOSY_MIN_UPLOAD = 101

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex')

/** Deterministic bytes that stand for a save's contents, different per seed. */
export function filler(seed, size) {
  const out = Buffer.alloc(size)
  let block = createHash('sha256').update(`galleon-save-fixture:${seed}`).digest()
  for (let at = 0; at < size; at += block.length) {
    block.copy(out, at)
    block = createHash('sha256').update(block).digest()
  }
  return out
}

/**
 * A zip of stored entries in the order given, with no directory entries and
 * a fixed timestamp, so the same entries always give the same bytes. Stored
 * rather than deflated: the hash is over the entries' contents (SPEC.md
 * section 4), and stored bytes cannot drift with the zlib a runner ships.
 */
export function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/**
 * `content_hash` as SPEC.md section 4 states it for an ordinary zip: the MD5
 * of the sorted `name:md5` lines of its file entries; for anything else, the
 * MD5 of the bytes. This is the fixtures' expected value, not the engine's
 * implementation (M2-04), and the round-trip harness holds RomM's own hash to it.
 */
export function contentHash(entries, bytes) {
  if (!entries) return md5(bytes)
  const lines = entries
    .filter((entry) => !entry.name.endsWith('/'))
    .map((entry) => `${entry.name}:${md5(entry.data)}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return md5(Buffer.from(lines.join('\n'), 'utf8'))
}

/** A PlayStation memory card image: the "MC" header frame, then data. */
function ps1Card(seed) {
  const card = filler(seed, 128 * 1024)
  card.fill(0, 0, 0x80)
  card.write('MC', 0, 'latin1')
  let xor = 0
  for (let i = 0; i < 0x7f; i++) xor ^= card[i]
  card[0x7f] = xor
  return card
}

/**
 * A PSP PARAM.SFO holding UTF-8 strings, enough for the CATEGORY that tells a
 * save folder from game data (SPEC.md section 10, PSP).
 */
function paramSfo(fields) {
  const keys = Object.keys(fields)
  const values = keys.map((key) => Buffer.from(`${fields[key]}\0`, 'utf8'))
  const keyTable = Buffer.from(keys.map((key) => `${key}\0`).join(''), 'utf8')
  const keyTablePadded = Buffer.concat([keyTable, Buffer.alloc((4 - (keyTable.length % 4)) % 4)])
  const index = Buffer.alloc(16 * keys.length)
  const data = []
  let keyOffset = 0
  let dataOffset = 0
  keys.forEach((key, i) => {
    const max = Math.ceil(values[i].length / 4) * 4
    index.writeUInt16LE(keyOffset, i * 16)
    index.writeUInt16LE(0x0204, i * 16 + 2)
    index.writeUInt32LE(values[i].length, i * 16 + 4)
    index.writeUInt32LE(max, i * 16 + 8)
    index.writeUInt32LE(dataOffset, i * 16 + 12)
    data.push(values[i], Buffer.alloc(max - values[i].length))
    keyOffset += Buffer.byteLength(key) + 1
    dataOffset += max
  })
  const header = Buffer.alloc(20)
  header.write('\0PSF', 0, 'latin1')
  header.writeUInt32LE(0x0101, 4)
  header.writeUInt32LE(20 + index.length, 8)
  header.writeUInt32LE(20 + index.length + keyTablePadded.length, 12)
  header.writeUInt32LE(keys.length, 16)
  return Buffer.concat([header, index, keyTablePadded, ...data])
}

/** A GameCube GCI: the 64-byte directory entry, then whole 8 KiB blocks. */
function gci({ game, maker, name, blocks }) {
  const header = Buffer.alloc(0x40, 0)
  header.write(game, 0, 'latin1')
  header.write(maker, 4, 'latin1')
  header[6] = 0xff
  header.write(name, 8, 'latin1')
  header.writeUInt16BE(blocks, 0x38)
  header.writeUInt16BE(0xffff, 0x3a)
  return Buffer.concat([header, filler(`${game}-${name}`, blocks * 8192)])
}

const PSP_ID = 'GTST00001'
const WII_ID = Buffer.from('RGAL', 'latin1').toString('hex')

/**
 * Every fixture: where it lives, the SPEC.md sections it follows, the library
 * ROM it belongs to (test/romm/make-library.mjs), and what Argosy uploads it
 * with. `localName` is set where the file on the Android device is named
 * differently from the upload.
 */
const DEFINITIONS = [
  {
    path: 'snes/Galleon Test Cartridge (USA).srm',
    spec: ['3.1', '3.2', '10 SNES'],
    rom: 'roms/SNES/Galleon Test Cartridge (USA).sfc',
    emulator: 'snes9x',
    build: (seed) => filler(seed, 8 * 1024)
  },
  {
    path: 'gba/Galleon Test Handheld (Europe).srm',
    spec: ['3.1', '3.2', '10 GBA'],
    rom: 'roms/gba/Galleon Test Handheld (Europe).gba',
    emulator: 'mgba',
    build: (seed) => filler(seed, 32 * 1024)
  },
  {
    path: 'ps1/Galleon Test Single (USA).srm',
    spec: ['3.1', '3.2', '10 PS1'],
    rom: 'roms/ps1/Galleon Test Single (USA).chd',
    emulator: 'pcsx_rearmed',
    build: ps1Card
  },
  {
    path: 'ps1/Galleon Test Saga (USA).mcd',
    localName: 'Galleon Test Saga (USA)_1.mcd',
    spec: ['3.1', '10 PS1'],
    rom: 'roms/ps1/Galleon Test Saga (USA)',
    emulator: 'duckstation',
    build: ps1Card
  },
  {
    path: 'psp/Galleon Test Portable (USA).zip',
    spec: ['3.2', '4', '10 PSP'],
    rom: 'roms/psp/Galleon Test Portable (USA)',
    emulator: 'ppsspp',
    entries: (seed) => [
      {
        name: `${PSP_ID}DATA00/PARAM.SFO`,
        data: paramSfo({
          CATEGORY: 'MS',
          SAVEDATA_DIRECTORY: `${PSP_ID}DATA00`,
          TITLE: 'Galleon Test Portable'
        })
      },
      { name: `${PSP_ID}DATA00/DATA.BIN`, data: filler(`${seed}:data`, 16 * 1024) },
      {
        name: `${PSP_ID}SETTINGS/PARAM.SFO`,
        data: paramSfo({
          CATEGORY: 'MS',
          SAVEDATA_DIRECTORY: `${PSP_ID}SETTINGS`,
          TITLE: 'Galleon Test Portable'
        })
      },
      { name: `${PSP_ID}SETTINGS/SETTINGS.BIN`, data: filler(`${seed}:settings`, 512) }
    ]
  },
  {
    path: 'ps2/Galleon Test Disc (USA).zip',
    note: 'Game-rooted, the shape the code writes.',
    spec: ['3.2', '4', '10 PS2'],
    rom: 'roms/ps2/Galleon Test Disc (USA).iso',
    emulator: 'armsx2',
    entries: (seed) => [
      { name: 'BASLUS-99901GALLEON/BASLUS-99901GALLEON', data: filler(`${seed}:data`, 24 * 1024) },
      { name: 'BASLUS-99901GALLEON/icon.sys', data: filler(`${seed}:icon.sys`, 964) }
    ]
  },
  {
    path: 'ps2/Galleon Test Track (USA).zip',
    note: "Card-rooted, the shape Argosy's docs describe and its restore still accepts; which one the owner's server holds is M2-02's question 3.",
    spec: ['4', '10 PS2', '12'],
    rom: 'roms/ps2/Galleon Test Track (USA).cue',
    emulator: 'aethersx2',
    entries: (seed) => [
      {
        name: 'Mcd001.ps2/BASLUS-99902GALLEON/BASLUS-99902GALLEON',
        data: filler(`${seed}:data`, 24 * 1024)
      },
      { name: 'Mcd001.ps2/BASLUS-99902GALLEON/icon.sys', data: filler(`${seed}:icon.sys`, 964) }
    ]
  },
  {
    path: 'ngc/Galleon Test Cube (USA).gci',
    note: 'One GCI is uploaded raw.',
    spec: ['3.2', '10 GameCube'],
    rom: 'roms/ngc/Galleon Test Cube (USA).iso',
    emulator: 'dolphin',
    build: () => gci({ game: 'GTCE', maker: '01', name: 'galleon_cube', blocks: 2 })
  },
  {
    path: 'ngc/Galleon Test Two Discs (USA).zip',
    note: 'Several GCIs go up as a flat zip, sorted by name.',
    spec: ['3.2', '4', '10 GameCube'],
    rom: 'roms/ngc/Galleon Test Two Discs (USA)',
    emulator: 'dolphin',
    entries: () => [
      {
        name: '01-GTDE-galleon_config.gci',
        data: gci({ game: 'GTDE', maker: '01', name: 'galleon_config', blocks: 1 })
      },
      {
        name: '01-GTDE-galleon_save.gci',
        data: gci({ game: 'GTDE', maker: '01', name: 'galleon_save', blocks: 3 })
      }
    ]
  },
  {
    path: 'wii/Galleon Test Remote (USA).zip',
    note: "The title folder's name format comes from sigil and is M2-02's question 7.",
    spec: ['3.2', '4', '10 Wii', '12'],
    rom: 'roms/wii/Galleon Test Remote (USA).iso',
    emulator: 'dolphin',
    entries: (seed) => [
      { name: `${WII_ID}/data/banner.bin`, data: filler(`${seed}:banner`, 24 * 1024) },
      { name: `${WII_ID}/data/galleon.dat`, data: filler(`${seed}:save`, 16 * 1024) }
    ]
  },
  {
    path: 'dc/Galleon Test Dream (USA).bin',
    localName: 'T-99901N.A1.bin',
    spec: ['3.1', '10 Dreamcast'],
    rom: 'roms/dc/Galleon Test Dream (USA).chd',
    emulator: 'flycast',
    build: (seed) => filler(seed, 128 * 1024)
  }
]

/** Every fixture's bytes and its manifest entry, built in memory. */
export function buildFixtures() {
  return DEFINITIONS.map((definition) => {
    const { path, build, entries: makeEntries, ...rest } = definition
    const entries = makeEntries ? makeEntries(path) : null
    const bytes = entries ? zip(entries) : build(path)
    const uploadName = path.split('/').pop()
    return {
      bytes,
      entry: {
        path,
        system: path.split('/')[0],
        ...rest,
        slot: 'autosave',
        uploadName,
        shape: entries ? 'zip' : 'raw',
        bytes: bytes.length,
        md5: md5(bytes),
        contentHash: contentHash(entries, bytes),
        ...(entries
          ? {
              entries: entries.map((e) => ({
                name: e.name,
                bytes: e.data.length,
                md5: md5(e.data)
              }))
            }
          : {})
      }
    }
  })
}

/** The manifest as committed: stable key order, one trailing newline. */
export function manifestText(fixtures) {
  return `${JSON.stringify({ fixtures: fixtures.map((f) => f.entry) }, null, 2)}\n`
}

/** Every file under a directory, as forward-slash paths relative to it. */
export function filesUnder(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/** What differs between the built fixtures and those on disk; empty when none. */
export function differences(root = FIXTURES) {
  const fixtures = buildFixtures()
  const problems = []
  const expected = new Map(fixtures.map((f) => [f.entry.path, f.bytes]))
  expected.set(MANIFEST, Buffer.from(manifestText(fixtures), 'utf8'))
  let present = []
  try {
    present = filesUnder(root)
  } catch {
    return [`${root} does not exist`]
  }
  for (const file of present) {
    if (!expected.has(file)) problems.push(`${file}: not built by fixtures.mjs`)
  }
  for (const [file, bytes] of expected) {
    if (!present.includes(file)) problems.push(`${file}: missing`)
    else if (!readFileSync(join(root, file)).equals(bytes)) problems.push(`${file}: bytes differ`)
  }
  return problems
}

export function writeFixtures(root = FIXTURES) {
  const fixtures = buildFixtures()
  rmSync(root, { recursive: true, force: true })
  for (const { entry, bytes } of fixtures) {
    mkdirSync(dirname(join(root, entry.path)), { recursive: true })
    writeFileSync(join(root, entry.path), bytes)
  }
  writeFileSync(join(root, MANIFEST), manifestText(fixtures))
  return fixtures.length
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--write') {
    console.log(`wrote ${writeFixtures()} fixtures to ${relative(process.cwd(), FIXTURES)}`)
  } else if (args.length === 0) {
    const problems = differences()
    for (const problem of problems) console.error(problem)
    if (problems.length > 0) process.exit(1)
    console.log('test/fixtures/saves matches fixtures.mjs')
  } else {
    console.error(`usage: fixtures.mjs [--write], not: ${args.join(' ')}`)
    process.exit(2)
  }
}
