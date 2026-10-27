/**
 * Valve's text KeyValues format, as Steam writes `libraryfolders.vdf` and each
 * library's `appmanifest_<appid>.acf`.
 *
 * A file is a list of pairs; a value is a quoted string or a braced block of
 * further pairs. Steam reads keys without regard to case, and older builds
 * wrote `LibraryFolders` and `AppState` where newer ones write them in lower
 * case, so lookups go through `field` rather than indexing.
 */

export interface VdfObject {
  [key: string]: VdfValue
}

export type VdfValue = string | VdfObject

type Token = { kind: 'string'; text: string } | { kind: 'open' } | { kind: 'close' }

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"' }

/** Every token in the text, or null where a quoted string never closes. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  let at = 0
  while (at < source.length) {
    const char = source[at]
    if (/\s/.test(char)) {
      at++
    } else if (source.startsWith('//', at)) {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end
    } else if (char === '{') {
      tokens.push({ kind: 'open' })
      at++
    } else if (char === '}') {
      tokens.push({ kind: 'close' })
      at++
    } else if (char === '[') {
      // A platform condition such as `[$WIN32]` after a pair. Steam's own
      // Linux files carry none that would exclude a pair, so it is read past.
      const end = source.indexOf(']', at)
      if (end === -1) return null
      at = end + 1
    } else if (char === '"') {
      let value = ''
      at++
      for (;;) {
        if (at >= source.length) return null
        const next = source[at]
        if (next === '"') break
        if (next === '\\' && at + 1 < source.length) {
          const escaped = source[at + 1]
          value += ESCAPES[escaped] ?? `\\${escaped}`
          at += 2
        } else {
          value += next
          at++
        }
      }
      tokens.push({ kind: 'string', text: value })
      at++
    } else {
      // An unquoted word runs to whitespace or a brace.
      const start = at
      while (at < source.length && !/[\s{}"]/.test(source[at])) at++
      tokens.push({ kind: 'string', text: source.slice(start, at) })
    }
  }
  return tokens
}

/**
 * The pairs in the text, or null when it is not well formed: a string or a
 * block left open, a value missing, a brace with nothing to close.
 *
 * A file Steam was writing when it was read, or one cut short by a full disk,
 * is malformed rather than half read, so a caller never sees a manifest with
 * its later fields missing.
 */
export function parseVdf(source: string): VdfObject | null {
  const tokens = tokenize(source)
  if (!tokens) return null
  let at = 0

  function pairsOf(nested: boolean): VdfObject | null {
    const pairs: VdfObject = {}
    for (;;) {
      const key = tokens![at]
      if (!key) return nested ? null : pairs
      if (key.kind === 'close') {
        if (!nested) return null
        at++
        return pairs
      }
      if (key.kind !== 'string') return null
      at++
      const value = tokens![at]
      if (!value || value.kind === 'close') return null
      at++
      const inner = value.kind === 'string' ? value.text : pairsOf(true)
      if (inner === null) return null
      // Defined rather than assigned, so a key of `__proto__` is a key.
      Object.defineProperty(pairs, key.text, {
        value: inner,
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
  }

  return pairsOf(false)
}

/** The value under `name`, whatever its case in the file. */
export function field(object: VdfObject, name: string): VdfValue | undefined {
  if (Object.hasOwn(object, name)) return object[name]
  const wanted = name.toLowerCase()
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === wanted)
  return key === undefined ? undefined : object[key]
}

/** The string under `name`, or undefined when it is absent or a block. */
export function text(object: VdfObject, name: string): string | undefined {
  const value = field(object, name)
  return typeof value === 'string' ? value : undefined
}

/** The block under `name`, or undefined when it is absent or a string. */
export function block(object: VdfObject, name: string): VdfObject | undefined {
  const value = field(object, name)
  return typeof value === 'object' ? value : undefined
}
