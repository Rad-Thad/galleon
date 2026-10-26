import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dolphin, flycast } from '@config/emulators'
import { applySettingsEdits, settingsBackups } from './settingsedits.ts'

/** A complete Dolphin.ini as a hand-tuned install has it, slot A a card file. */
const DOLPHIN_INI = join(import.meta.dirname, '../../test/fixtures/settings/Dolphin.ini')
/** A complete emu.cfg as Flycast writes it, its per-game VMU turned off. */
const FLYCAST_CFG = join(import.meta.dirname, '../../test/fixtures/settings/emu.cfg')

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
