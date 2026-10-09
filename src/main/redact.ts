/**
 * What a diagnostics report may not carry, taken out of text before it leaves
 * the device.
 *
 * The log already scrubs what it writes (see `scrub` in `log.ts`), but a
 * report also carries files the log never saw — the launcher's own log, the
 * settings, the environment — and is handed to someone else. So everything
 * that goes into one passes through here as plain text, whatever wrote it.
 *
 * Pure, and deliberately greedy: a version string mistaken for an address
 * costs a reader a moment, while an address or a token that slips through
 * cannot be taken back once the report is shared.
 */

export interface RedactOptions {
  /** The configured RomM base URL, whose host is replaced wherever it appears. */
  serverUrl?: string | null
}

export const SERVER = '<server>'
export const IP = '<ip>'
export const REMOVED = '<removed>'

/**
 * Words that make a key's value a secret, in `key=value`, `key: value` or JSON
 * form. Matched anywhere in the key, so `ROMM_PASSWORD`, `csrf_token` and
 * `deviceCode` are caught as well as the bare words.
 */
const SECRET_WORDS =
  'password|passwd|token|secret|api[-_]?key|cookie|authorization|device_?code|user_?code|pairing_?code'
const SECRET_KEY = `[A-Za-z0-9_.-]*(?:${SECRET_WORDS})[A-Za-z0-9_.-]*`

const KEYED_JSON = new RegExp(
  `("${SECRET_KEY}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|[^,}\\s]+)`,
  'gi'
)
const KEYED_TEXT = new RegExp(`\\b(${SECRET_KEY}\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s&,;}]+)`, 'gi')
/** A pairing code named in prose, as a person or a message would write it. */
const PAIRING_PROSE = /\b((?:pairing|device|user) code\s*[=:]?\s*)[A-Za-z0-9-]+/gi
/** The user and password a pasted `https://user:password@host` carries. */
const USERINFO = /\b(https?:\/\/)[^/@\s]+@/gi

/** A header line a request or response carried, value and all. */
const HEADER = /\b((?:set-)?cookie|authorization)(\s*:\s*)[^\r\n]*/gi
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi
const CLIENT_TOKEN = /\brmm_[A-Za-z0-9_-]+/g

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const HEX = '[0-9a-f]{1,4}'
/**
 * The full eight-group form, or any form with `::`. Requiring one of those
 * keeps clock times (`16:27:01`) and ratios out, which a looser pattern of
 * colon-separated digits would take for addresses.
 */
const IPV6 = new RegExp(
  `(?<![0-9a-z:])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){1,7}:(?:${HEX}(?::${HEX}){0,6})?|::(?:${HEX}(?::${HEX}){0,6})?)(?![0-9a-z:])`,
  'gi'
)

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The host a base URL names, or nothing for one that does not parse. */
export function serverHost(serverUrl: string | null | undefined): string | null {
  if (!serverUrl) return null
  try {
    const host = new URL(serverUrl).hostname.replace(/^\[|\]$/g, '')
    return host || null
  } catch {
    return null
  }
}

export function redact(text: string, options: RedactOptions = {}): string {
  let out = text
  const host = serverHost(options.serverUrl)
  // The host first, so an address-shaped one is named for what it is rather
  // than as an anonymous address.
  if (host) out = out.replace(new RegExp(escape(host), 'gi'), SERVER)
  out = out
    .replace(USERINFO, `$1${REMOVED}@`)
    .replace(HEADER, `$1$2${REMOVED}`)
    .replace(BEARER, `$1 ${REMOVED}`)
    .replace(CLIENT_TOKEN, REMOVED)
    .replace(KEYED_JSON, `$1"${REMOVED}"`)
    .replace(KEYED_TEXT, `$1${REMOVED}`)
    .replace(PAIRING_PROSE, `$1${REMOVED}`)
    .replace(IPV4, IP)
    .replace(IPV6, IP)
  return out
}
