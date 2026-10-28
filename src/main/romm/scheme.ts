import { t } from '../i18n.ts'
import { RommError } from './errors.ts'

/**
 * Which scheme a server address typed without one should carry.
 *
 * A home RomM is as likely to be plain http on a port of its own as https
 * behind a proxy, and guessing https alone made every such address fail with
 * the runtime's 'fetch failed' until the user thought to type http://. So an
 * address without a scheme is asked over https first and then over http, and
 * the first that answers like RomM is the one saved, scheme and all: later
 * starts never probe, so a certificate that stops working one day is reported
 * rather than quietly traded for an unencrypted connection.
 */

/** Strip trailing slashes so we can concatenate paths safely. */
export function normaliseBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) throw new RommError(t('error.serverAddressEmpty'))
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const parsed = new URL(url)
  // A user pasting the RomM web UI URL often includes a path; keep it, but drop
  // a trailing /api which we add ourselves.
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '')
  // `https://user:password@host` is a realistic paste, since RomM accepts HTTP
  // basic — and this string is written to settings.json, which `store.ts` says
  // holds no secrets, and printed beside every request. RomMix authenticates
  // with a token, so there is nothing here to keep.
  parsed.username = ''
  parsed.password = ''
  // Request paths are concatenated onto what this returns, so anything the URL
  // carries after the path would sit between the base and `/api/...`. A pasted
  // web UI address is the realistic source of both: a fragment is never sent,
  // so every call would fetch `/`.
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/+$/, '')
}

/** What one heartbeat against one address came back as. */
export type ProbeAnswer =
  | { kind: 'romm' }
  /** Something answered, but not RomM's heartbeat: a router page, another app. */
  | { kind: 'not-romm' }
  /** An https server is there, and its certificate was refused. */
  | { kind: 'tls'; reason: string }
  | { kind: 'unreachable'; reason: string }

/** One `GET /api/heartbeat` against `baseUrl`. See `RommClient.probe`. */
export type Probe = (baseUrl: string) => Promise<ProbeAnswer>

/**
 * The runtime's codes for a certificate it would not accept.
 *
 * Only these count as a TLS problem. An https request to a server that speaks
 * plain http fails in the handshake too, but with a protocol error, and that is
 * the ordinary case this file exists for rather than a certificate to report.
 */
const CERTIFICATE_CODE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/

/** Read a failed request's cause chain as a certificate problem or no answer. */
export function failureOf(cause: unknown): ProbeAnswer {
  let reason: string | null = null
  for (let at = cause, depth = 0; at instanceof Error && depth < 5; depth++) {
    const code = (at as Error & { code?: unknown }).code
    if (typeof code === 'string' && CERTIFICATE_CODE.test(code)) {
      return { kind: 'tls', reason: at.message || code }
    }
    // The innermost message is the one that says what happened; the runtime's
    // outer one is only 'fetch failed'.
    if (at.message) reason = at.message
    at = at.cause
  }
  return { kind: 'unreachable', reason: reason ?? String(cause) }
}

/** Whether the address was typed with a scheme, which is then never changed. */
export function hasScheme(input: string): boolean {
  return /^https?:\/\//i.test(input.trim())
}

/**
 * The base URL to save for what the user typed, or a message saying why none.
 *
 * An explicit scheme is only ever asked over that scheme. When an explicit
 * https address does not answer, http is asked once too, only to say so: the
 * user typed https, and connecting them over something else would not be what
 * they asked for.
 */
export async function resolveBaseUrl(input: string, probe: Probe): Promise<string> {
  // Without a scheme `normaliseBaseUrl` gives https, which is asked first.
  const url = normaliseBaseUrl(input)
  const http = url.replace(/^https:/i, 'http:')

  if (hasScheme(input)) {
    const answer = await probe(url)
    if (answer.kind === 'romm') return url
    if (answer.kind === 'unreachable' && url !== http && (await probe(http)).kind === 'romm') {
      throw new RommError(t('error.httpNotHttps', { url, http }))
    }
    throw failure(url, answer)
  }

  const https = url

  const first = await probe(https)
  if (first.kind === 'romm') return https
  // A certificate refused is an https server that is really there. Falling back
  // to http past it is exactly the downgrade the user would never see.
  if (first.kind === 'tls') throw failure(https, first)
  const second = await probe(http)
  if (second.kind === 'romm') return http
  if (first.kind === 'unreachable' && second.kind === 'unreachable') {
    throw new RommError(t('error.nothingAnsweredEither', { https, http, reason: second.reason }))
  }
  throw new RommError(
    t('error.neitherScheme', { https, first: attempt(first), http, second: attempt(second) })
  )
}

function failure(url: string, answer: Exclude<ProbeAnswer, { kind: 'romm' }>): RommError {
  switch (answer.kind) {
    case 'not-romm':
      return new RommError(t('error.notRomm', { url }))
    case 'tls':
      return new RommError(t('error.certificate', { url, reason: answer.reason }))
    case 'unreachable':
      return new RommError(t('error.nothingAnswered', { url, reason: answer.reason }))
  }
}

/** One attempt as a phrase inside `error.neitherScheme`. */
function attempt(answer: Exclude<ProbeAnswer, { kind: 'romm' }>): string {
  if (answer.kind === 'not-romm') return t('error.attemptNotRomm')
  return t('error.attemptNothing', { reason: answer.reason })
}
