/**
 * Binary VDF read and written back exactly, for changing a shortcuts.vdf
 * that holds the owner's own shortcuts.
 *
 * `parseBinaryVdf` (shortcuts.ts) reads a list into a plain object for
 * listing, which loses what a writer must keep: the order of the fields, the
 * type of each fixed-width one, and bytes that are not UTF-8. Here each field
 * keeps all three, so a file read and written unchanged comes back byte for
 * byte, and a file that could not be is refused rather than rewritten.
 *
 * A map is a 0x00 byte, a NUL-terminated name and its fields up to a 0x08
 * byte; a string field is 0x01, an int32 0x02; the other fixed-width types
 * are kept as their raw bytes.
 */

export type BinaryVdfField =
  | { type: 'map'; name: string; fields: BinaryVdfField[] }
  | { type: 'string'; name: string; value: string }
  /** Stored signed; written from either its signed or its unsigned reading. */
  | { type: 'int32'; name: string; value: number }
  | { type: 'fixed'; code: number; name: string; bytes: Uint8Array }

const MAP = 0x00
const STRING = 0x01
const INT32 = 0x02
const END = 0x08
/**
 * The other fixed-width field types, by width. A reader that meets any other
 * type cannot know where the next field starts, so the file is unreadable.
 */
const FIXED: Record<number, number> = { 0x03: 4, 0x04: 4, 0x06: 4, 0x07: 8 }
/** Deeper than any file Steam writes; a crafted file cannot exhaust the stack. */
const MAX_DEPTH = 16

// Fatal, and keeping a leading byte-order mark, so every string that decodes
// encodes back to the bytes it came from.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

/** Caught by `readBinaryVdf`; never leaves this file. */
class Malformed extends Error {}

/**
 * The file's top-level fields, or null when it could not be written back
 * exactly: cut short, an unknown type, text that is not UTF-8, or bytes after
 * the top-level end.
 */
export function readBinaryVdf(data: Uint8Array): BinaryVdfField[] | null {
  try {
    const [fields, at] = readMap(data, 0, 0)
    return at === data.length ? fields : null
  } catch (cause) {
    if (cause instanceof Malformed) return null
    throw cause
  }
}

function readMap(data: Uint8Array, at: number, depth: number): [BinaryVdfField[], number] {
  if (depth > MAX_DEPTH) throw new Malformed()
  const fields: BinaryVdfField[] = []
  for (;;) {
    if (at >= data.length) throw new Malformed()
    const code = data[at++]
    if (code === END) return [fields, at]
    const [name, afterName] = readString(data, at)
    at = afterName
    if (code === MAP) {
      const [inner, after] = readMap(data, at, depth + 1)
      fields.push({ type: 'map', name, fields: inner })
      at = after
    } else if (code === STRING) {
      const [value, after] = readString(data, at)
      fields.push({ type: 'string', name, value })
      at = after
    } else if (code === INT32) {
      if (at + 4 > data.length) throw new Malformed()
      const value = new DataView(data.buffer, data.byteOffset + at, 4).getInt32(0, true)
      fields.push({ type: 'int32', name, value })
      at += 4
    } else if (code in FIXED) {
      const width = FIXED[code]
      if (at + width > data.length) throw new Malformed()
      fields.push({ type: 'fixed', code, name, bytes: data.slice(at, at + width) })
      at += width
    } else {
      throw new Malformed()
    }
  }
}

function readString(data: Uint8Array, at: number): [string, number] {
  const end = data.indexOf(0, at)
  if (end < 0) throw new Malformed()
  try {
    return [utf8.decode(data.subarray(at, end)), end + 1]
  } catch {
    throw new Malformed()
  }
}

/**
 * The bytes for these top-level fields. Throws on a field Steam could not
 * read back as written: text holding a NUL or a lone surrogate, an int32 out of range, fixed
 * bytes of the wrong width for their type.
 */
export function writeBinaryVdf(fields: BinaryVdfField[]): Uint8Array {
  const out: number[] = []
  writeMap(out, fields)
  return Uint8Array.from(out)
}

function writeMap(out: number[], fields: BinaryVdfField[]): void {
  for (const field of fields) {
    if (field.type === 'map') {
      out.push(MAP)
      writeString(out, field.name)
      writeMap(out, field.fields)
    } else if (field.type === 'string') {
      out.push(STRING)
      writeString(out, field.name)
      writeString(out, field.value)
    } else if (field.type === 'int32') {
      const { value } = field
      if (!Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff) {
        throw new RangeError(`int32 field ${field.name} out of range`)
      }
      out.push(INT32)
      writeString(out, field.name)
      const word = new Uint8Array(4)
      new DataView(word.buffer).setUint32(0, value >>> 0, true)
      out.push(...word)
    } else {
      if (FIXED[field.code] !== field.bytes.length) {
        throw new RangeError(`fixed field ${field.name} has the wrong width for its type`)
      }
      out.push(field.code)
      writeString(out, field.name)
      out.push(...field.bytes)
    }
  }
  out.push(END)
}

function writeString(out: number[], text: string): void {
  // A lone surrogate would be written as U+FFFD, not as what was asked for.
  const bytes = encoder.encode(text)
  if (text.includes('\0') || utf8.decode(bytes) !== text) {
    throw new RangeError('binary VDF text must be well-formed and hold no NUL')
  }
  out.push(...bytes, 0)
}

/** The field called `name` among these, whatever its case: Steam has written `AppName` and `appname`. */
export function findField(fields: BinaryVdfField[], name: string): BinaryVdfField | undefined {
  const lower = name.toLowerCase()
  return fields.find((field) => field.name.toLowerCase() === lower)
}
