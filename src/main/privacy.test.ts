import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServerConfig } from '@shared/types'
import { MASK, Privacy } from './privacy.ts'

const SERVER: ServerConfig = {
  baseUrl: 'https://romm.home.example:8443',
  authMode: 'password',
  username: 'owner-name'
}

const privacy = (server: ServerConfig | null = SERVER): Privacy => new Privacy(() => server)

test('the connection status names neither the server nor the account', () => {
  const status = {
    connected: true,
    configured: true,
    offline: false,
    baseUrl: SERVER.baseUrl,
    user: {
      id: 1,
      username: 'owner-name',
      email: 'owner@example.org',
      avatar_path: 'assets/users/1/avatar.png',
      ra_username: 'ra-owner',
      oauth_scopes: ['roms.read']
    },
    serverVersion: '4.4.0',
    missingScopes: [],
    error: null
  }
  const shown = privacy().hide(status)
  assert.equal(shown.baseUrl, MASK)
  assert.equal(shown.user.username, MASK)
  assert.equal(shown.user.email, MASK)
  assert.equal(shown.user.ra_username, MASK)
  assert.equal(shown.user.avatar_path, '')
  // What is not about the owner is untouched, so the screens still work.
  assert.equal(shown.serverVersion, '4.4.0')
  assert.deepEqual(shown.user.oauth_scopes, ['roms.read'])
  assert.equal(shown.connected, true)
  // A copy: the main process keeps the real values.
  assert.equal(status.baseUrl, SERVER.baseUrl)
  assert.equal(status.user.username, 'owner-name')
})

test('an error that quotes the address or the host hides both, whatever their case', () => {
  const hide = privacy()
  assert.equal(
    hide.hide(`${SERVER.baseUrl} did not answer`),
    `${MASK} did not answer`,
    'the whole address goes, not its host inside it'
  )
  assert.equal(hide.hide('could not reach ROMM.home.example:8443'), `could not reach ${MASK}`)
  assert.equal(
    hide.hide('getaddrinfo ENOTFOUND romm.home.example'),
    `getaddrinfo ENOTFOUND ${MASK}`
  )
})

test('the account name is hidden in other text once a field has carried it', () => {
  const hide = privacy({ baseUrl: 'http://10.0.0.2', authMode: 'token' })
  hide.hide({ user: { username: 'Zelda-Fan' } })
  assert.equal(hide.hide('Connected as Zelda-Fan'), `Connected as ${MASK}`)
})

test('the account name from the stored sign-in is hidden before any status names it', () => {
  assert.equal(privacy().hide('Connected as owner-name'), `Connected as ${MASK}`)
})

test('a pairing code and its address are hidden', () => {
  const shown = privacy().hide({
    device_code: 'dev-secret',
    user_code: 'ABCD-1234',
    verification_path: '/pair',
    verification_path_complete: '/pair?code=ABCD-1234',
    expires_in: 600,
    interval: 5
  })
  assert.deepEqual(shown, {
    device_code: MASK,
    user_code: MASK,
    verification_path: MASK,
    verification_path_complete: MASK,
    expires_in: 600,
    interval: 5
  })
})

test('lists, nested objects and the values beside a secret are walked', () => {
  const shown = privacy().hide([
    { items: [{ title: 'Pocket Homebrew', url: `${SERVER.baseUrl}/api/roms/1` }] },
    3,
    null,
    true
  ])
  assert.deepEqual(shown, [
    { items: [{ title: 'Pocket Homebrew', url: `${MASK}/api/roms/1` }] },
    3,
    null,
    true
  ])
})

test('a short name is hidden as a whole value, not inside words', () => {
  const hide = privacy({ baseUrl: 'http://10.0.0.2', authMode: 'password', username: 'ab' })
  assert.equal(hide.hide('ab'), MASK)
  assert.equal(hide.hide('Absolute about'), 'Absolute about')
})

test('without a server only the fields are hidden', () => {
  const hide = privacy(null)
  assert.deepEqual(hide.hide({ username: 'x', title: 'Home' }), { username: MASK, title: 'Home' })
  assert.equal(hide.hide(undefined), undefined)
  const when = new Date(0)
  assert.equal(hide.hide(when), when, 'class instances pass through')
})

test('an address that is not a URL is still hidden whole', () => {
  const hide = privacy({ baseUrl: 'not a url', authMode: 'token' })
  assert.equal(hide.hide('tried not a url'), `tried ${MASK}`)
})
