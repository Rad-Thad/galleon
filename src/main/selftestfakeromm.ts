import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AUTOSAVE_SLOT } from '@shared/saveassets'
import { RommClient } from './romm/client.ts'
import { localContentHash } from './savehash.ts'
import type { CheckResult, Scenario } from './selftest.ts'
import { Store } from './store.ts'

/**
 * `saves.fake-server`: one save uploaded to the on-device fake RomM (M2-20)
 * and downloaded again, through the app's own client, as the save engine
 * makes those calls: the device registered, the upload into the autosave
 * slot without `overwrite`, the download under that device, and its
 * confirmation.
 *
 * The client here is a second one, with a store of its own in a scratch
 * folder that knows only the fake's loopback address and token. The app's
 * own client keeps its read-only guard on the owner's server throughout, so
 * `safety.server-readonly` still answers for that server alone; nothing this
 * check sends can reach it, since this client was never told where it is.
 * The scratch folder holds a copy of the fake's token and goes when the
 * check ends.
 */

export const FAKE_SERVER_CHECK = 'saves.fake-server'

/**
 * The game the save is filed under. The fake knows only the ROM ids run.sh
 * gives it (`FAKE_ROMM_ROM_IDS`), which must include this one.
 */
export const FAKE_ROM_ID = 1

/** Below the test home, made fresh for each run of the check. */
export const SCRATCH_PREFIX = 'fake-romm-client-'

/** The save's size: a battery save's order, made of random bytes each run. */
export const SAVE_BYTES = 32 * 1024

const SAVE_NAME = 'galleon-fake-server.srm'

export interface FakeServerSources {
  /** The test home; the scratch folder is made under it. */
  work: string
  /** The code under test; a test swaps in a faulty one to see the check fail. */
  client?: (store: Store) => RommClient
  now?: () => number
}

export function fakeServerScenario(sources: FakeServerSources): Scenario {
  const makeClient = sources.client ?? ((store: Store) => new RommClient(store))
  const now = sources.now ?? Date.now
  return async ({ request }) => {
    const fake = request.fakeRomm
    if (!fake) return result('fail', {}, 'no-fake-romm')
    const scratch = await mkdtemp(join(sources.work, SCRATCH_PREFIX))
    try {
      const token = (await readFile(fake.tokenFile, 'utf8')).trim()
      if (!token) return result('fail', {}, 'no-token')
      const store = new Store(join(scratch, 'state'))
      store.setServer({ baseUrl: fake.baseUrl, authMode: 'token' })
      store.setCredentials({ clientToken: token })
      const client = makeClient(store)

      const sent = randomBytes(SAVE_BYTES)
      const from = join(scratch, SAVE_NAME)
      await writeFile(from, sent)
      const deviceId = await client.deviceId()
      if (!deviceId) return result('fail', {}, 'not-registered')

      const upAt = now()
      const saved = await client.uploadSave(FAKE_ROM_ID, from, SAVE_NAME, null, AUTOSAVE_SLOT)
      const uploadMs = now() - upAt
      const listed = (await client.savesForDevice(FAKE_ROM_ID, deviceId)).some(
        (save) => save.id === saved.id
      )

      const to = join(scratch, 'downloaded')
      const downAt = now()
      await client.downloadSave(saved.id, to)
      await client.confirmSaveDownloaded(saved.id)
      const downloadMs = now() - downAt

      const back = await readFile(to)
      const metrics = { bytes: sent.length, uploadMs, downloadMs }
      if (!listed) return result('fail', metrics, 'not-listed')
      if (!back.equals(sent)) return result('fail', metrics, 'bytes-differ')
      if (saved.content_hash !== (await localContentHash(from))) {
        return result('fail', metrics, 'hash-differs')
      }
      return result('pass', metrics, null)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
}

function result(
  outcome: 'pass' | 'fail',
  metrics: CheckResult['metrics'],
  reason: string | null
): CheckResult {
  return {
    id: FAKE_SERVER_CHECK,
    result: outcome,
    metrics,
    thresholds: {},
    reason,
    evidence: []
  }
}
