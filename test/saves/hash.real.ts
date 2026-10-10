/**
 * `content_hash` (M2-04): RomM 5.2.0's stored hash against the app's own
 * (`src/main/savehash.ts`), for every edge case in `hashcases.mjs` and every
 * golden fixture.
 *
 *   npm run test:saves
 *
 * Only ever against the disposable servers in test/romm/compose.yml.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contentHashOf } from '../../src/main/savehash.ts'
import { assertFitsSchema, client, romNamed, scratch, watch } from '../romm/server.ts'
import { FIXTURES, MANIFEST } from './fixtures.mjs'
import type { FixtureEntry } from './fixtures.mjs'
import { hashCases } from './hashcases.mjs'

const fixtures = (
  JSON.parse(readFileSync(join(FIXTURES, MANIFEST), 'utf8')) as { fixtures: FixtureEntry[] }
).fixtures

test('RomM stores the hash the app computes, for every edge case', async (t) => {
  const rom = await romNamed('Galleon Test Handheld (Europe).gba')
  const dir = scratch(t)
  const sent = watch()
  const fork = client(`galleon-test-hash-${randomBytes(6).toString('hex')}`)
  for (const [name, bytes] of Object.entries(hashCases())) {
    const file = join(dir, name)
    writeFileSync(file, bytes)
    // No slot: these are checks of the hash, not saves of the game, and a
    // slotless upload pairs with nothing on the next negotiate.
    const saved = await fork.uploadSave(
      rom.id,
      file,
      `galleon-hash-${name}-${randomBytes(4).toString('hex')}.sav`,
      null,
      null,
      { overwrite: false }
    )
    assert.equal(saved.content_hash, await contentHashOf(file), name)
  }
  assertFitsSchema(sent)
})

test("RomM's stored hash of every golden fixture is the app's", async () => {
  const fork = client(`galleon-test-hash-${randomBytes(6).toString('hex')}`)
  for (const entry of fixtures) {
    const path = join(FIXTURES, entry.path)
    const rom = await romNamed(entry.rom.split('/').at(-1)!)
    const saved = await fork.uploadSave(
      rom.id,
      path,
      `galleon-hash-${randomBytes(4).toString('hex')}-${entry.uploadName}`,
      entry.emulator,
      null,
      { overwrite: false }
    )
    assert.equal(saved.content_hash, await contentHashOf(path), entry.path)
  }
})
