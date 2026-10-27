import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { armsx2, dolphin, flycast } from '@config/emulators'
import { applySettingsEdits, settingsBackups } from './settingsedits.ts'

/** A complete Dolphin.ini as a hand-tuned install has it, slot A a card file. */
const DOLPHIN_INI = join(import.meta.dirname, '../../test/fixtures/settings/Dolphin.ini')
/** A complete emu.cfg as Flycast writes it, its per-game VMU turned off. */
const FLYCAST_CFG = join(import.meta.dirname, '../../test/fixtures/settings/emu.cfg')
/** A complete PCSX2.ini as ARMSX2 writes it, slot 1 its default card file. */
const ARMSX2_INI = join(import.meta.dirname, '../../test/fixtures/settings/PCSX2.ini')

function setUp(withFile = true): { configDir: string; ini: string; backups: string } {
  const root = mkdtempSync(join(tmpdir(), 'galleon-settings-'))
  const configDir = join(root, 'config')
  const ini = join(configDir, 'dolphin-emu', 'Dolphin.ini')
  mkdirSync(join(configDir, 'dolphin-emu'), { recursive: true })
  if (withFile) copyFileSync(DOLPHIN_INI, ini)
  return { configDir, ini, backups: settingsBackups('dolphin', join(root, 'saves')) }
}

const gcEdits = dolphin.settingsEdits?.({ system: 'gc' }) ?? []

test("Dolphin's slot A becomes a GCI folder, every other byte of its file kept", async () => {
  const { configDir, ini, backups } = setUp()
  await applySettingsEdits(configDir, gcEdits, backups)

  const before = readFileSync(DOLPHIN_INI, 'utf8').split('\n')
  const after = readFileSync(ini, 'utf8').split('\n')
  assert.equal(after.length, before.length)
  const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]))
  assert.deepEqual(changed, [['SlotA = 1', 'SlotA = 8']])
  // The card file it named is still named, so the card is left where it is.
  assert.ok(
    after.includes('MemcardAPath = /home/deck/.local/share/dolphin-emu/GC/MemoryCardA.USA.raw')
  )
})

test('the file it replaced is kept first, byte for byte', async () => {
  const { configDir, backups } = setUp()
  await applySettingsEdits(configDir, gcEdits, backups)
  const copies = readdirSync(backups)
  assert.equal(copies.length, 1)
  assert.ok(readFileSync(join(backups, copies[0])).equals(readFileSync(DOLPHIN_INI)))
})

test('a file already set is not written, and gets no backup', async () => {
  const { configDir, ini, backups } = setUp()
  await applySettingsEdits(configDir, gcEdits, backups)
  const set = readFileSync(ini)
  await applySettingsEdits(configDir, gcEdits, backups)
  assert.ok(readFileSync(ini).equals(set))
  assert.equal(readdirSync(backups).length, 1)
})

test('a settings file that is not there is never started fresh', async () => {
  const { configDir, ini, backups } = setUp(false)
  await applySettingsEdits(configDir, gcEdits, backups)
  assert.throws(() => readFileSync(ini), { code: 'ENOENT' })
  assert.deepEqual(readdirSync(join(configDir, 'dolphin-emu')), [])
})

test('an edit naming a file outside the config folder is refused', async () => {
  const { configDir, backups } = setUp()
  for (const file of ['../Dolphin.ini', '/etc/Dolphin.ini']) {
    await assert.rejects(
      () => applySettingsEdits(configDir, [{ ...gcEdits[0], file }], backups),
      /outside the emulator's config folder/
    )
  }
})

test('only GameCube games need slot A; a Wii game changes nothing', () => {
  assert.equal(gcEdits.length, 1)
  assert.deepEqual(dolphin.settingsEdits?.({ system: 'wii' }), [])
})

const flycastEdits = flycast.settingsEdits?.({ system: 'dreamcast' }) ?? []

function setUpFlycast(text: string | null): { configDir: string; cfg: string; backups: string } {
  const root = mkdtempSync(join(tmpdir(), 'galleon-settings-'))
  const configDir = join(root, 'config')
  const cfg = join(configDir, 'flycast', 'emu.cfg')
  mkdirSync(join(configDir, 'flycast'), { recursive: true })
  if (text !== null) writeFileSync(cfg, text)
  return { configDir, cfg, backups: settingsBackups('flycast', join(root, 'saves')) }
}

test("Flycast's VMU becomes one per game, every other byte of its file kept", async () => {
  const original = readFileSync(FLYCAST_CFG, 'utf8')
  const { configDir, cfg, backups } = setUpFlycast(original)
  await applySettingsEdits(configDir, flycastEdits, backups)

  const before = original.split('\n')
  const after = readFileSync(cfg, 'utf8').split('\n')
  assert.equal(after.length, before.length)
  const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]))
  assert.deepEqual(changed, [['PerGameVmu = no', 'PerGameVmu = yes']])
  const copies = readdirSync(backups)
  assert.equal(copies.length, 1)
  assert.equal(readFileSync(join(backups, copies[0]), 'utf8'), original)
})

test("an emu.cfg without the key is left alone, per-game being Flycast's own default", async () => {
  const without = readFileSync(FLYCAST_CFG, 'utf8').replace('PerGameVmu = no\n', '')
  const { configDir, cfg, backups } = setUpFlycast(without)
  await applySettingsEdits(configDir, flycastEdits, backups)
  assert.equal(readFileSync(cfg, 'utf8'), without)
  assert.throws(() => readdirSync(backups), { code: 'ENOENT' })
})

test('a Flycast that has never run gets no emu.cfg', async () => {
  const { configDir, cfg, backups } = setUpFlycast(null)
  await applySettingsEdits(configDir, flycastEdits, backups)
  assert.throws(() => readFileSync(cfg), { code: 'ENOENT' })
})

const armsx2Edits = armsx2.settingsEdits?.({ system: 'ps2' }) ?? []

function setUpArmsx2(text: string | null): {
  configDir: string
  ini: string
  memcards: string
  backups: string
} {
  const root = mkdtempSync(join(tmpdir(), 'galleon-settings-'))
  const configDir = join(root, 'config')
  const ini = join(configDir, 'ARMSX2', 'inis', 'PCSX2.ini')
  const memcards = join(configDir, 'ARMSX2', 'memcards')
  mkdirSync(join(configDir, 'ARMSX2', 'inis'), { recursive: true })
  mkdirSync(memcards)
  // The card file slot 1 named, with a save of the player's on it.
  writeFileSync(join(memcards, 'Mcd001.ps2'), 'a card with saves on it')
  if (text !== null) writeFileSync(ini, text)
  return { configDir, ini, memcards, backups: settingsBackups('armsx2', join(root, 'saves')) }
}

test("ARMSX2's slot 1 becomes a folder card, every other byte of its file kept", async () => {
  const original = readFileSync(ARMSX2_INI, 'utf8')
  const { configDir, ini, memcards, backups } = setUpArmsx2(original)
  await applySettingsEdits(configDir, armsx2Edits, backups)

  const before = original.split('\n')
  const after = readFileSync(ini, 'utf8').split('\n')
  assert.equal(after.length, before.length)
  const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]))
  assert.deepEqual(changed, [['Slot1_Filename = Mcd001.ps2', 'Slot1_Filename = Shared.ps2']])
  const copies = readdirSync(backups)
  assert.equal(copies.length, 1)
  assert.equal(readFileSync(join(backups, copies[0]), 'utf8'), original)

  // The folder the key names is a folder card as ARMSX2 makes one, so ARMSX2
  // does not make a card file of that name; the card file is left as it was.
  assert.ok(statSync(join(memcards, 'Shared.ps2')).isDirectory())
  assert.deepEqual(readdirSync(join(memcards, 'Shared.ps2')), ['_pcsx2_superblock'])
  assert.equal(readFileSync(join(memcards, 'Shared.ps2', '_pcsx2_superblock'), 'utf8'), '')
  assert.equal(readFileSync(join(memcards, 'Mcd001.ps2'), 'utf8'), 'a card with saves on it')
})

test('a PCSX2.ini without the key gets it, its default card being a file', async () => {
  const without = readFileSync(ARMSX2_INI, 'utf8').replace('Slot1_Filename = Mcd001.ps2\n', '')
  const { configDir, ini, backups } = setUpArmsx2(without)
  await applySettingsEdits(configDir, armsx2Edits, backups)
  const after = readFileSync(ini, 'utf8')
  assert.match(after, /\[MemoryCards\]\n(?:.*\n)*?Slot1_Filename = Shared\.ps2\n/)
  assert.equal(after.replace('Slot1_Filename = Shared.ps2\n', ''), without)
})

test('a folder card already there is used as it is, its saves untouched', async () => {
  const { configDir, ini, memcards, backups } = setUpArmsx2(readFileSync(ARMSX2_INI, 'utf8'))
  mkdirSync(join(memcards, 'Shared.ps2', 'BASLUS-20152AC04'), { recursive: true })
  writeFileSync(join(memcards, 'Shared.ps2', '_pcsx2_superblock'), 'formatted')
  await applySettingsEdits(configDir, armsx2Edits, backups)
  assert.match(readFileSync(ini, 'utf8'), /Slot1_Filename = Shared\.ps2/)
  assert.deepEqual(readdirSync(join(memcards, 'Shared.ps2')).sort(), [
    'BASLUS-20152AC04',
    '_pcsx2_superblock'
  ])
  assert.equal(readFileSync(join(memcards, 'Shared.ps2', '_pcsx2_superblock'), 'utf8'), 'formatted')
})

test('a card file holding the name leaves slot 1 as it was', async () => {
  const original = readFileSync(ARMSX2_INI, 'utf8')
  const { configDir, ini, memcards, backups } = setUpArmsx2(original)
  writeFileSync(join(memcards, 'Shared.ps2'), 'a card file of the same name')
  await applySettingsEdits(configDir, armsx2Edits, backups)
  assert.equal(readFileSync(ini, 'utf8'), original)
  assert.equal(readFileSync(join(memcards, 'Shared.ps2'), 'utf8'), 'a card file of the same name')
  assert.throws(() => readdirSync(backups), { code: 'ENOENT' })
})

test('an ARMSX2 that has never run gets neither a PCSX2.ini nor a card', async () => {
  const { configDir, ini, memcards, backups } = setUpArmsx2(null)
  await applySettingsEdits(configDir, armsx2Edits, backups)
  assert.throws(() => readFileSync(ini), { code: 'ENOENT' })
  assert.deepEqual(readdirSync(memcards), ['Mcd001.ps2'])
})

test('an edit naming a folder outside the config folder is refused', async () => {
  const { configDir, memcards, backups } = setUpArmsx2(readFileSync(ARMSX2_INI, 'utf8'))
  const edit = armsx2Edits[0]
  for (const path of ['../Shared.ps2', '/tmp/Shared.ps2']) {
    await assert.rejects(
      () => applySettingsEdits(configDir, [{ ...edit, folder: { path, files: [] } }], backups),
      /outside the emulator's config folder/
    )
  }
  assert.deepEqual(readdirSync(memcards), ['Mcd001.ps2'])
})
