import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'

/**
 * A save's `content_hash`, computed the way RomM 5.2.0 computes the one it
 * stores (docs/save-sync/SPEC.md section 4), so that "the same save" means the
 * same thing on both ends.
 *
 * RomM asks Python's `zipfile.is_zipfile` first, which looks for an
 * end-of-central-directory record near the end of the file, not for a zip
 * signature at the start. A file it calls a zip is hashed as the MD5 of the
 * sorted `name:md5(entry)` lines, directories left out; anything else is the
 * MD5 of its bytes; any error while reading gives no hash at all. Each of
 * those choices is copied here, edge cases included, because a hash that
 * differs from the server's turns an unchanged save into a conflict.
 *
 * Files are streamed: a save folder zipped by an emulator can be larger than
 * memory on the device can spare, and no read here is larger than
 * `READ_CHUNK_BYTES` or the end-of-archive search.
 */

/** The size of each read from disk while hashing. */
export const READ_CHUNK_BYTES = 64 * 1024

const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06])
const EOCD_BYTES = 22
const MAX_COMMENT_BYTES = 0xffff
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_LOCATOR_BYTES = 20
const UTF8_FLAG = 0x800
const STORED = 0
const DEFLATED = 8

/**
 * Why a file has no hash. It never leaves `contentHashOf`, which turns every
 * error into null, so its reason is for a debugger, not for anyone's screen.
 */
class Unhashable extends Error {}

/** Called with the length of every buffer read from disk; tests use it. */
export type ReadObserver = (bytes: number) => void

/**
 * RomM's `content_hash` for the file at `path`, or null where RomM would store
 * none: an unreadable file, or one that looks like a zip and cannot be read
 * as one.
 *
 * A zip using a compression method other than stored or deflate also gives
 * null, though RomM's Python can read bzip2 and LZMA: no save tool Argosy
 * meets writes them (SPEC.md section 10), and null makes the caller fall back
 * to its other evidence rather than trust a wrong hash.
 */
export async function contentHashOf(path: string, onRead?: ReadObserver): Promise<string | null> {
  try {
    const end = await endOfCentralDirectory(path, onRead)
    if (end === null) return await fileMd5(path, onRead)
    return await zipHash(path, end, onRead)
  } catch {
    return null
  }
}

interface EndRecord {
  fileSize: number
  /** Where the record starts. */
  at: number
  centralDirectoryBytes: number
  centralDirectoryOffset: number
  commentBytes: number
  zip64: boolean
}

/**
 * `zipfile._EndRecData`: the record in the last 22 bytes with no comment, or
 * else the last signature in the final 64 KiB and 22 bytes that has a whole
 * record after it. Null where Python's `is_zipfile` says "not a zip".
 */
async function endOfCentralDirectory(
  path: string,
  onRead?: ReadObserver
): Promise<EndRecord | null> {
  const handle = await open(path, 'r')
  try {
    const fileSize = (await handle.stat()).size
    if (fileSize < EOCD_BYTES) return null
    const readAt = async (position: number, length: number): Promise<Buffer> => {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      onRead?.(length)
      return buffer.subarray(0, bytesRead)
    }

    let at = -1
    const last = await readAt(fileSize - EOCD_BYTES, EOCD_BYTES)
    if (last.subarray(0, 4).equals(EOCD_SIGNATURE) && last.readUInt16LE(EOCD_BYTES - 2) === 0) {
      at = fileSize - EOCD_BYTES
    } else {
      const from = Math.max(fileSize - MAX_COMMENT_BYTES - EOCD_BYTES, 0)
      const tail = await readAt(from, fileSize - from)
      const found = tail.lastIndexOf(EOCD_SIGNATURE)
      if (found < 0 || found + EOCD_BYTES > tail.length) return null
      at = from + found
    }

    const record = await readAt(at, EOCD_BYTES)
    let zip64 = false
    if (at >= ZIP64_LOCATOR_BYTES) {
      const locator = await readAt(at - ZIP64_LOCATOR_BYTES, 4)
      zip64 = locator.readUInt32LE(0) === ZIP64_LOCATOR_SIGNATURE
    }
    return {
      fileSize,
      at,
      centralDirectoryBytes: record.readUInt32LE(12),
      centralDirectoryOffset: record.readUInt32LE(16),
      commentBytes: record.readUInt16LE(20),
      zip64
    }
  } finally {
    await handle.close()
  }
}

function fileMd5(path: string, onRead?: ReadObserver): Promise<string> {
  return new Promise((resolve, reject) => {
    const md5 = createHash('md5')
    createReadStream(path, { highWaterMark: READ_CHUNK_BYTES })
      .on('data', (chunk) => {
        onRead?.(chunk.length)
        md5.update(chunk)
      })
      .on('error', reject)
      .on('end', () => resolve(md5.digest('hex')))
  })
}

/**
 * The file as yauzl should see it. Python reads a zip that has bytes in front
 * of it (a self-extractor, or a save tool's own header) by measuring how far
 * the central directory sits from where the record says; the reader starts
 * that far in, so yauzl, which takes offsets literally, reads the same zip.
 */
class Window extends yauzl.RandomAccessReader {
  constructor(
    private readonly path: string,
    private readonly skip: number,
    private readonly onRead?: ReadObserver
  ) {
    super()
  }

  override _readStreamForRange(start: number, end: number): Readable {
    const stream = createReadStream(this.path, {
      start: this.skip + start,
      end: this.skip + end - 1,
      highWaterMark: READ_CHUNK_BYTES
    })
    if (this.onRead) stream.on('data', (chunk) => this.onRead!(chunk.length))
    return stream
  }
}

async function zipHash(path: string, end: EndRecord, onRead?: ReadObserver): Promise<string> {
  // Zip64 archives carry their own offsets, which yauzl reads; a prefix in
  // front of one is not a shape any save tool writes.
  const skip = end.zip64 ? 0 : end.at - end.centralDirectoryBytes - end.centralDirectoryOffset
  if (skip < 0) throw new Unhashable('the central directory starts before the file')
  // Python ignores whatever follows the comment, and yauzl refuses it, so the
  // window ends where the comment does.
  const last = Math.min(end.fileSize, end.at + EOCD_BYTES + end.commentBytes)
  const zip = await yauzl.fromRandomAccessReaderPromise(
    new Window(path, skip, onRead),
    last - skip,
    { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true }
  )
  try {
    // Python's `zf.read(name)` reads the last entry of that name, so every
    // line for a repeated name carries the last one's hash.
    const names: string[] = []
    const md5ByName = new Map<string, string>()
    for (;;) {
      const entry = await nextEntry(zip)
      if (entry === null) break
      const name = entryName(entry)
      names.push(name)
      if (!name.endsWith('/')) md5ByName.set(name, await entryMd5(zip, entry))
    }
    const lines = names
      .sort(byCodePoint)
      .filter((name) => !name.endsWith('/'))
      .map((name) => `${name}:${md5ByName.get(name)}`)
    return createHash('md5')
      .update(Buffer.from(lines.join('\n'), 'utf8'))
      .digest('hex')
  } finally {
    zip.close()
  }
}

function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      zip.off('entry', onEntry).off('end', onEnd).off('error', onError)
    }
    const onEntry = (entry: yauzl.Entry): void => (cleanup(), resolve(entry))
    const onEnd = (): void => (cleanup(), resolve(null))
    const onError = (error: Error): void => (cleanup(), reject(error))
    zip.on('entry', onEntry).on('end', onEnd).on('error', onError)
    zip.readEntry()
  })
}

/**
 * The entry's bytes, hashed as they stream, with the checksum Python's read
 * checks: a damaged entry is an error there, so it is one here.
 */
function entryMd5(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  if (entry.isEncrypted()) return Promise.reject(new Unhashable('encrypted entry'))
  if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATED) {
    return Promise.reject(new Unhashable(`compression method ${entry.compressionMethod}`))
  }
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error)
      const md5 = createHash('md5')
      let crc = 0
      stream
        .on('data', (chunk: Buffer) => {
          md5.update(chunk)
          crc = crc32(chunk, crc)
        })
        .on('error', reject)
        .on('end', () => {
          if (crc >>> 0 !== entry.crc32 >>> 0) reject(new Unhashable('bad CRC-32'))
          else resolve(md5.digest('hex'))
        })
    })
  })
}

/**
 * The name as Python's zipfile decodes it: UTF-8 when the entry says so,
 * otherwise code page 437, cut at the first NUL.
 */
export function entryName(entry: {
  fileName: string | Buffer
  generalPurposeBitFlag: number
}): string {
  const raw = typeof entry.fileName === 'string' ? Buffer.from(entry.fileName) : entry.fileName
  const name =
    entry.generalPurposeBitFlag & UTF8_FLAG
      ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
      : Array.from(raw, (byte) =>
          byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80]
        ).join('')
  const nul = name.indexOf('\0')
  return nul === -1 ? name : name.slice(0, nul)
}

/** Code page 437's upper half, which is what Python decodes a legacy name with. */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

/** Python's string order: by code point, which UTF-16 order is not. */
export function byCodePoint(a: string, b: string): number {
  const left = Array.from(a)
  const right = Array.from(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return left.length - right.length
}
