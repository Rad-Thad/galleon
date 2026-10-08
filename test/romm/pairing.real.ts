/**
 * Device pairing end to end against a provisioned Docker RomM, the flow a
 * player walks from the TV: the app asks for a code, the admin approves it in
 * RomM, and the app exchanges it for a token and a device id.
 *
 *   docker compose -f test/romm/compose.yml --profile v520 up -d
 *   node test/romm/provision.mjs --profile v520
 *   ROMM_PROFILE=v520 node --import ./scripts/test-resolve.mjs \
 *     --experimental-transform-types --test test/romm/pairing.real.ts
 *
 * Not part of `npm test`: it needs the server, and fails rather than skips
 * when there is none.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REQUIRED_SCOPES } from '../../src/main/romm/client.ts'
import { basicAuth, statePath, type State } from './lib.mjs'

const profile = process.env.ROMM_PROFILE ?? 'v520'

function readState(): State {
  try {
    return JSON.parse(readFileSync(statePath(profile), 'utf8')) as State
  } catch {
    throw new Error(
      `no provisioned ${profile}: run node test/romm/provision.mjs --profile ${profile}`
    )
  }
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

test(`pairs a device end to end on RomM ${profile}`, async () => {
  const { baseUrl, admin } = readState()
  const identifier = `galleon-pairing-${Date.now()}`

  const init = await post(`${baseUrl}/api/auth/device/init`, {
    client_device_identifier: identifier,
    name: 'Galleon pairing test',
    client: 'galleon',
    platform: 'linux',
    client_version: '0.0.0-test',
    requested_scopes: REQUIRED_SCOPES
  })
  assert.equal(init.status, 201, await init.clone().text())
  const { device_code, user_code } = (await init.json()) as {
    device_code: string
    user_code: string
  }
  assert.ok(device_code && user_code)

  // Before approval the exchange must not hand out a token.
  const early = await post(`${baseUrl}/api/auth/device/token`, { device_code })
  assert.ok(!early.ok, `token issued before approval: ${early.status}`)

  const approve = await post(
    `${baseUrl}/api/auth/device/approve`,
    { user_code, approved_scopes: REQUIRED_SCOPES, device_name: 'Galleon pairing test' },
    { Authorization: basicAuth(admin) }
  )
  assert.equal(approve.status, 200, await approve.clone().text())
  const approved = (await approve.json()) as { device_id: string }

  const exchange = await post(`${baseUrl}/api/auth/device/token`, { device_code })
  assert.equal(exchange.status, 200, await exchange.clone().text())
  const token = (await exchange.json()) as {
    access_token: string
    device_id: string
    scopes: string[]
  }
  assert.ok(token.access_token)
  assert.equal(token.device_id, approved.device_id)
  assert.deepEqual([...token.scopes].sort(), [...REQUIRED_SCOPES].sort())

  const me = await fetch(`${baseUrl}/api/users/me`, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  })
  assert.equal(me.status, 200)
  assert.equal(((await me.json()) as { username: string }).username, admin.username)

  const device = await fetch(`${baseUrl}/api/devices/${token.device_id}`, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  })
  assert.equal(device.status, 200, await device.clone().text())
})
