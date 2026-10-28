import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { RommError } from './errors.ts'
import { schemeNote } from '@shared/serverscheme'
import { createI18n } from '@shared/i18n'
import { failureOf, resolveBaseUrl, type ProbeAnswer } from './scheme.ts'

/**
 * Which scheme a typed address is saved with, against a fake transport.
 *
 * The owner's RomM is plain http on a port of its own, and an address typed
 * without a scheme used to become https and fail with 'fetch failed' until
 * http:// was typed. These hold the order of the attempts as much as their
 * outcome: an explicit scheme is never traded for another, and a refused
 * certificate is never stepped around.
 */

/** A transport that answers each address from `answers`, recording the order asked. */
function fake(answers: Record<string, ProbeAnswer>): {
  probe: (url: string) => Promise<ProbeAnswer>
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    probe: async (url) => {
      asked.push(url)
      return answers[url] ?? { kind: 'unreachable', reason: 'ECONNREFUSED' }
    }
  }
}

const HTTPS = 'https://nova.lan:8080'
const HTTP = 'http://nova.lan:8080'
const ROMM: ProbeAnswer = { kind: 'romm' }
const EN = createI18n('en')

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (cause) {
    assert.ok(cause instanceof RommError)
    return cause.message
  }
  assert.fail('expected a refusal')
}

describe('an address typed without a scheme', () => {
  test('https that answers like RomM is kept, and http is never asked', async () => {
    const { probe, asked } = fake({ [HTTPS]: ROMM, [HTTP]: ROMM })
    assert.equal(await resolveBaseUrl('nova.lan:8080', probe), HTTPS)
    assert.deepEqual(asked, [HTTPS])
    assert.equal(schemeNote(EN, HTTPS), null)
  })

  test('https failing and http answering keeps http, shown as not encrypted', async () => {
    const { probe, asked } = fake({
      [HTTPS]: { kind: 'unreachable', reason: 'wrong version number' },
      [HTTP]: ROMM
    })
    const saved = await resolveBaseUrl('nova.lan:8080/', probe)
    assert.equal(saved, HTTP)
    assert.deepEqual(asked, [HTTPS, HTTP])
    assert.equal(schemeNote(EN, saved), 'Connected over http (not encrypted)')
  })

  test('http is kept when https answers but is something other than RomM', async () => {
    const { probe } = fake({ [HTTPS]: { kind: 'not-romm' }, [HTTP]: ROMM })
    assert.equal(await resolveBaseUrl('nova.lan:8080', probe), HTTP)
  })

  test('both failing is one message naming both attempts', async () => {
    const { probe, asked } = fake({})
    const message = await refusal(resolveBaseUrl('nova.lan:8080', probe))
    assert.deepEqual(asked, [HTTPS, HTTP])
    assert.equal(message, `Nothing answered at ${HTTPS} or at ${HTTP}: ECONNREFUSED`)
  })

  test('both answering as something else says so for each', async () => {
    const { probe } = fake({
      [HTTPS]: { kind: 'unreachable', reason: 'timeout' },
      [HTTP]: { kind: 'not-romm' }
    })
    const message = await refusal(resolveBaseUrl('nova.lan:8080', probe))
    assert.equal(
      message,
      `Tried ${HTTPS} (nothing answered: timeout) and ${HTTP} (answered, but not as a RomM server).`
    )
  })

  test('a refused certificate is reported, never stepped around over http', async () => {
    const { probe, asked } = fake({
      [HTTPS]: { kind: 'tls', reason: 'certificate has expired' },
      [HTTP]: ROMM
    })
    const message = await refusal(resolveBaseUrl('nova.lan:8080', probe))
    assert.deepEqual(asked, [HTTPS])
    assert.match(message, /certificate was refused: certificate has expired/)
  })
})

describe('an address typed with a scheme', () => {
  test('is never changed: http stays http', async () => {
    const { probe, asked } = fake({ [HTTPS]: ROMM, [HTTP]: ROMM })
    assert.equal(await resolveBaseUrl(`${HTTP}/`, probe), HTTP)
    assert.deepEqual(asked, [HTTP])
  })

  test('is never changed: https that fails is not saved as http, and says http answered', async () => {
    const { probe, asked } = fake({ [HTTP]: ROMM })
    const message = await refusal(resolveBaseUrl(HTTPS, probe))
    assert.deepEqual(asked, [HTTPS, HTTP])
    assert.equal(
      message,
      `${HTTPS} did not answer, but ${HTTP} is a RomM server without encryption. Type the address with http:// to use it.`
    )
  })

  test('a later certificate failure is reported and not downgraded', async () => {
    // A saved address always carries its scheme, so this is what every later
    // connection to an https server whose certificate went bad looks like.
    const { probe, asked } = fake({ [HTTPS]: { kind: 'tls', reason: 'self-signed' }, [HTTP]: ROMM })
    const message = await refusal(resolveBaseUrl(HTTPS, probe))
    assert.deepEqual(asked, [HTTPS])
    assert.match(message, /certificate was refused/)
  })

  test('nothing answering, and answering as something else, read differently', async () => {
    assert.equal(
      await refusal(resolveBaseUrl(HTTP, fake({}).probe)),
      `Nothing answered at ${HTTP}: ECONNREFUSED`
    )
    assert.equal(
      await refusal(resolveBaseUrl(HTTP, fake({ [HTTP]: { kind: 'not-romm' } }).probe)),
      `${HTTP} answered, but it is not a RomM server`
    )
  })

  test('an empty address is refused before anything is asked', async () => {
    const { probe, asked } = fake({})
    await assert.rejects(() => resolveBaseUrl('  ', probe), RommError)
    assert.deepEqual(asked, [])
  })
})

describe('a failed request read', () => {
  /** The runtime's shape: 'fetch failed' around the socket's own error. */
  function fetchFailed(inner: Error & { code?: string }): Error {
    return new TypeError('fetch failed', { cause: inner })
  }

  test('a certificate code is a TLS problem', () => {
    const inner = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
    assert.deepEqual(failureOf(fetchFailed(inner)), {
      kind: 'tls',
      reason: 'certificate has expired'
    })
    const self = Object.assign(new Error('self-signed certificate'), {
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT'
    })
    assert.equal(failureOf(fetchFailed(self)).kind, 'tls')
  })

  test('https spoken to an http server is no answer, not a certificate problem', () => {
    const inner = Object.assign(new Error('wrong version number'), {
      code: 'ERR_SSL_WRONG_VERSION_NUMBER'
    })
    assert.deepEqual(failureOf(fetchFailed(inner)), {
      kind: 'unreachable',
      reason: 'wrong version number'
    })
  })

  test('the innermost message is the reason', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:8080'), {
      code: 'ECONNREFUSED'
    })
    assert.deepEqual(failureOf(fetchFailed(inner)), {
      kind: 'unreachable',
      reason: 'connect ECONNREFUSED 10.0.0.2:8080'
    })
  })
})
