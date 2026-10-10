// The shape of hashcases.mjs, for the TypeScript that uses it.

export interface CaseEntry {
  name: string | Buffer
  data: Buffer
  crc?: number
}

export function bytesFor(seed: string, size: number): Buffer
export function storedZip(entries: CaseEntry[], options?: { comment?: Buffer }): Buffer
export function hashCases(): Record<
  | 'plain'
  | 'ordered'
  | 'reordered'
  | 'withDirectories'
  | 'prefixed'
  | 'trailing'
  | 'commented'
  | 'endInRawSave'
  | 'zipSignatureOnly'
  | 'badChecksum'
  | 'repeatedName'
  | 'legacyName'
  | 'astralName'
  | 'emptyZip',
  Buffer
>
