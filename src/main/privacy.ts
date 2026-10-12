import type { ServerConfig } from '@shared/types'

/**
 * Privacy mode: while the device self-test runs, nothing the interface draws
 * names the owner's server, their account or a pairing code.
 *
 * Applied where data leaves the main process for the page (every IPC answer,
 * every push, every error message) rather than in each screen, so a screen
 * added later, or an error that quotes the address, is covered without
 * anybody remembering to. Screenshots and the page's DOM are published by the
 * bridge, and its sanitiser reads text, not pixels.
 */

/** What a hidden value is drawn as. Symbols, so no language needs it. */
export const MASK = '••••'

/** Fields that hold the account's identity or a pairing secret, whatever their value. */
const SECRET_FIELDS = new Set([
  'username',
  'email',
  'ra_username',
  'user_code',
  'device_code',
  'verification_path',
  'verification_path_complete'
])

/**
 * Fields emptied rather than masked: the account's picture identifies it as
 * well as its name does, and a masked path would only be a broken image.
 */
const EMPTIED_FIELDS = new Set(['avatar_path'])

/**
 * A secret shorter than this is masked only where it is a whole value. Inside
 * longer text a two-letter name would match half the words on screen, and
 * masking those would hide what the screenshots are taken to show.
 */
const MIN_SUBSTRING = 3

export class Privacy {
  /** Values met in a secret field, so the same value in other text is hidden too. */
  private readonly learned = new Set<string>()

  constructor(private readonly server: () => ServerConfig | null) {}

  /** A copy of the value with every secret in it replaced. The value is left alone. */
  hide<T>(value: T): T {
    const secrets = this.secrets()
    return this.walk(value, secrets) as T
  }

  private secrets(): string[] {
    const found = new Set(this.learned)
    const server = this.server()
    if (server) {
      found.add(server.baseUrl)
      if (server.username) found.add(server.username)
      try {
        const url = new URL(server.baseUrl)
        found.add(url.host)
        found.add(url.hostname)
      } catch {
        // Not a URL, so the whole value above is all there is to hide.
      }
    }
    // Longest first, so a host is not masked inside the address and leave the
    // scheme and path around a mask that the full address would have covered.
    return [...found].filter((s) => s.trim() !== '').sort((a, b) => b.length - a.length)
  }

  private walk(value: unknown, secrets: string[]): unknown {
    if (typeof value === 'string') return mask(value, secrets)
    if (Array.isArray(value)) return value.map((item) => this.walk(item, secrets))
    if (!isPlainObject(value)) return value
    // Secret fields first, so a value learned here is hidden in its siblings too.
    for (const [key, field] of Object.entries(value)) {
      if (SECRET_FIELDS.has(key) && typeof field === 'string' && field.trim() !== '') {
        if (!this.learned.has(field)) {
          this.learned.add(field)
          return this.walk(value, this.secrets())
        }
      }
    }
    const out: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(value)) {
      if (EMPTIED_FIELDS.has(key) && typeof field === 'string') out[key] = ''
      else if (SECRET_FIELDS.has(key) && typeof field === 'string' && field !== '') out[key] = MASK
      else out[key] = this.walk(field, secrets)
    }
    return out
  }
}

function mask(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (out === secret) return MASK
    if (secret.length < MIN_SUBSTRING) continue
    // Hosts are case-insensitive, and an error may quote one as typed.
    out = out.replace(new RegExp(escape(secret), 'gi'), MASK)
  }
  return out
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Data as IPC carries it; class instances (a Date, a Buffer) pass through. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}
