/**
 * The save contract against Docker RomM 5.2.0 (M2-20); see `contract.ts`. The
 * same file runs against the fake the device bundle carries as
 * `contract-fake.test.ts`.
 *
 *   npm run test:saves
 *   ROMM_PROFILE=v520 npm run test:saves-real
 *
 * Only ever against the disposable servers in test/romm/compose.yml.
 */
import { romNamed, state } from '../romm/server.ts'
import { saveContract } from './contract.ts'

saveContract(`RomM ${state.version}`, async () => ({
  baseUrl: state.baseUrl,
  token: state.clientToken,
  romId: (await romNamed('Galleon Test Plain (USA).iso')).id
}))
