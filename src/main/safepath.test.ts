import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeJoin } from './safepath.ts'

/**
 * Keeping a name that came from somewhere else inside the folder it is for.
 *
 * RomM decides what a ROM and a firmware file are called, and a zip decides
 * what is inside it. The server is the user's own, so this is not a stranger's
 * input — but it is not RomMix's either, and where a file is written should be
 * decided by RomMix rather than by the string it was handed.
 *
 * The cases below come in two kinds. Most are about the name alone and are
 * asked of a folder that does not exist, because the string is the whole
 * question and a directory would add nothing. The rest are about links, which
 * only a real directory can have — and which the ordinary answer depends on:
 * a save folder under EmuDeck *is* a link, and refusing those would refuse
 * every save it keeps.
 */

const ROOT = '/home/player/roms/genesis'

const roots: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-safepath-test-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

test('an ordinary name lands where it belongs', async () => {
  assert.equal(await safeJoin(ROOT, 'Sonic (USA).md'), `${ROOT}/Sonic (USA).md`)
  assert.equal(
    await safeJoin(ROOT, 'Final Fantasy VII/disc1.bin'),
    `${ROOT}/Final Fantasy VII/disc1.bin`
  )
})

test('a name that climbs out of the folder is refused, not corrected', async () => {
  // Refused rather than trimmed to its basename: a name that does not belong
  // here is one to reject, and rewriting it installs a file under something
  // other than what it is called.
  assert.equal(await safeJoin(ROOT, '../../../.bashrc'), null)
  assert.equal(await safeJoin(ROOT, '..'), null)
  assert.equal(await safeJoin(ROOT, '../genesis-elsewhere/x.md'), null)
})

test('the string form is not the question — where it lands is', async () => {
  // `a/../../b` and `../b` reach the same place and only one of them looks it.
  assert.equal(await safeJoin(ROOT, 'a/../../b'), null)
  assert.equal(await safeJoin(ROOT, './Sonic.md'), `${ROOT}/Sonic.md`)
  assert.equal(await safeJoin(ROOT, 'sub/../Sonic.md'), `${ROOT}/Sonic.md`)
})

test('an absolute name is not a name in this folder', async () => {
  assert.equal(await safeJoin(ROOT, '/etc/passwd'), null)
})

test('a backslash is an ordinary character in a filename here', async () => {
  // Linux allows it, so a game really can be called this. Only an archive's
  // own entry names need it read as a separator — see `entryTarget` in zip.ts.
  assert.equal(await safeJoin(ROOT, 'AC\\DC.md'), `${ROOT}/AC\\DC.md`)
})

test('the folder itself is not a file in it', async () => {
  assert.equal(await safeJoin(ROOT, ''), null)
  assert.equal(await safeJoin(ROOT, '.'), null)
})

test('a name that reaches out through a link is refused', async () => {
  // The case the string cannot answer: every segment of this name is an
  // ordinary one, and the path it lands on is in the user's home. A directory
  // like `disc` is what a multi-file game installs, and a server that names
  // its files `disc/.bashrc` writes there rather than into the game folder.
  const scratchRoot = scratch()
  const root = join(scratchRoot, 'genesis')
  mkdirSync(root, { recursive: true })
  symlinkSync(scratchRoot, join(root, 'disc'))

  assert.equal(await safeJoin(root, 'disc/.bashrc'), null)
})

test('a folder that is itself a link is where its files belong', async () => {
  // EmuDeck builds its save tree out of links into wherever each emulator
  // really writes, so this is the ordinary case rather than the exotic one.
  // The link is followed once, as the root, and what is inside it is inside it.
  const scratchRoot = scratch()
  const real = join(scratchRoot, 'real-saves')
  const root = join(scratchRoot, 'linked-saves')
  mkdirSync(real, { recursive: true })
  symlinkSync(real, root)

  assert.equal(await safeJoin(root, 'Sonic.srm'), join(root, 'Sonic.srm'))
})

test('a link that stays inside the folder is a file in it', async () => {
  const root = scratch()
  mkdirSync(join(root, 'discs'), { recursive: true })
  symlinkSync(join(root, 'discs'), join(root, 'shortcut'))

  assert.equal(await safeJoin(root, 'shortcut/disc1.bin'), join(root, 'shortcut/disc1.bin'))
})

test('a folder that is not there yet is still below the link it hangs off', async () => {
  // The ordinary Steam Deck arrangement: `Emulation` is a link onto the SD
  // card, and the system folder under it is made by the very download being
  // planned. Resolving what exists on one side and not the other would refuse
  // the first game of every system, which is the setup this check is for.
  const scratchRoot = scratch()
  mkdirSync(join(scratchRoot, 'card'), { recursive: true })
  symlinkSync(join(scratchRoot, 'card'), join(scratchRoot, 'Emulation'))
  const root = join(scratchRoot, 'Emulation', 'roms', 'gba')

  assert.equal(await safeJoin(root, 'Game.gba'), join(root, 'Game.gba'))
})

test('a file that is itself a link is a file in the folder', async () => {
  // A ROM library kept on another drive and linked into the emulator's folder
  // is how a shared collection is usually arranged, and every one of those
  // games is a link pointing out of the folder it is listed in. The folders a
  // name walks through are what is resolved; the name itself is not.
  const scratchRoot = scratch()
  const root = join(scratchRoot, 'genesis')
  const elsewhere = join(scratchRoot, 'Sonic.md')
  mkdirSync(root, { recursive: true })
  writeFileSync(elsewhere, '')
  symlinkSync(elsewhere, join(root, 'Sonic.md'))

  assert.equal(await safeJoin(root, 'Sonic.md'), join(root, 'Sonic.md'))
})

test('the name handed back is the one asked about, links and all', async () => {
  // Not the resolved path: the link is how the emulator finds the file, and a
  // caller given the real one would write past the arrangement the user made.
  const scratchRoot = scratch()
  const real = join(scratchRoot, 'cards')
  const root = join(scratchRoot, 'pcsx2')
  mkdirSync(join(root, 'memcards'), { recursive: true })
  mkdirSync(real, { recursive: true })
  symlinkSync(join(root, 'memcards'), join(root, 'saves'))
  writeFileSync(join(root, 'memcards', 'Mcd001.ps2'), '')

  assert.equal(
    await safeJoin(root, 'saves/Mcd001.ps2'),
    join(root, 'saves', 'Mcd001.ps2'),
    'the resolved path was handed back in place of the name'
  )
})
