/**
 * Device pairing end to end against a provisioned Docker RomM, the flow a
 * player walks from the TV: the app asks for a code, the admin approves it in
 * RomM, and the app exchanges it for a token and a device id. The app's side
 * is RomMix's own client; the admin's approval is the test acting in RomM's
 * web UI. Every request, both sides, is held to the version's document.
 *
 *   npm run test:romm
 *   ROMM_PROFILE=v520 npm run test:romm-real
 *
 * Not part of `npm test`: it needs the server, and fails rather than skips
 * when there is none.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { REQUIRED_SCOPES } from '../../src/main/romm/client.ts'
import { basicAuth } from './lib.mjs'
import { assertFitsSchema, client, state, watch } from './server.ts'

test(`pairs a device end to end on RomM ${state.version}`, async () => {
  const sent = watch()
  const rommix = client(`galleon-pairing-${randomBytes(6).toString('hex')}`, { signedIn: false })

  const { device_code, user_code } = await rommix.startDevicePairing(state.baseUrl)
  assert.ok(device_code && user_code)

  // Before approval the exchange must not hand out a token.
  assert.equal(await rommix.pollDevicePairing(device_code, state.baseUrl), false)
  assert.equal(await rommix.deviceId(), null)

  const approve = await fetch(`${state.baseUrl}/api/auth/device/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuth(state.admin) },
    body: JSON.stringify({
      user_code,
      approved_scopes: REQUIRED_SCOPES,
      device_name: 'Galleon pairing test'
    })
  })
  assert.equal(approve.status, 200, await approve.clone().text())
  const approved = (await approve.json()) as { device_id: string }

  assert.equal(await rommix.pollDevicePairing(device_code, state.baseUrl), true)
  assert.equal(await rommix.deviceId(), approved.device_id)

  // Signed in with the token the exchange stored, as the admin who approved.
  assert.equal((await rommix.me()).username, state.admin.username)
  assert.ok((await rommix.devices()).some((device) => device.id === approved.device_id))
  assertFitsSchema(sent)
})
