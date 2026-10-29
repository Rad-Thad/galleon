/**
 * The save contract against the fake RomM the device bundle runs (M2-20); see
 * `contract.ts`. The same file runs against Docker RomM 5.2.0 as
 * `contract.real.ts`.
 */
import { after, before } from 'node:test'
import { tmpdir } from 'node:os'
import { startFakeRomm, type FakeRomm } from '../device/fake-romm/server.ts'
import { saveContract } from './contract.ts'

const TOKEN = 'rmm_fake_token_for_the_save_contract'
const ROM_ID = 7

let server: FakeRomm
before(async () => {
  server = await startFakeRomm({ token: TOKEN, romIds: [ROM_ID], scratch: tmpdir() })
})
after(() => server.close())

saveContract('fake RomM', () =>
  Promise.resolve({ baseUrl: server.baseUrl, token: TOKEN, romId: ROM_ID })
)
