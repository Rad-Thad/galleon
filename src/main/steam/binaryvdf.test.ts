import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { binaryVdf, type Field, shortcut } from '../fixtures/steam/binaryvdf.ts'
import { type BinaryVdfField, findField, readBinaryVdf, writeBinaryVdf } from './binaryvdf.ts'

/** A shortcut with every field Steam's client writes, in its order and with its types. */
function steamShortcut(appid: number, name: string): Record<string, Field> {
  return {
    appid: appid | 0,
    AppName: name,
    Exe: `"/home/deck/Applications/${name}.sh"`,
    StartDir: '"/home/deck/Applications/"',
    icon: '',
    ShortcutPath: '',
    LaunchOptions: '/usr/libexec/armada/armada-game-launch %command%',
    IsHidden: 0,
    AllowDesktopConfig: 1,
    AllowOverlay: 1,
    OpenVR: 0,
    Devkit: 0,
    DevkitGameID: '',
    DevkitOverrideAppID: 0,
    LastPlayTime: 1761600000,
    FlatpakAppID: '',
    sortas: '',
    tags: { '0': 'favourite', '1': 'Émulateurs ★' }
  }
}

/** A list as Steam writes it, with the other fixed types beside the common ones. */
function realShaped(): Uint8Array {
  return binaryVdf({
    shortcuts: {
      '0': steamShortcut(3000000000, 'RetroArch'),
      '1': steamShortcut(123456789, 'Galleon'),
      '2': {
        ...shortcut(2500000000, 'Odd', 'appname'),
        colour: Uint8Array.from([0x10, 0x20, 0x30, 0xff]),
        big: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
      }
    }
  })
}

describe('readBinaryVdf and writeBinaryVdf', () => {
  test('a real-shaped list round-trips byte for byte', () => {
    const bytes = realShaped()
    const fields = readBinaryVdf(bytes)
    assert.ok(fields)
    assert.deepEqual(writeBinaryVdf(fields), bytes)
  })

  test('every field keeps its type, its order and its value', () => {
    const fields = readBinaryVdf(realShaped())!
    const list = findField(fields, 'shortcuts')
    assert.equal(list?.type, 'map')
    const entries = (list as { fields: BinaryVdfField[] }).fields
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['0', '1', '2']
    )
    const first = (entries[0] as { fields: BinaryVdfField[] }).fields
    assert.deepEqual(first.map((field) => field.name).slice(0, 4), [
      'appid',
      'AppName',
      'Exe',
      'StartDir'
    ])
    assert.deepEqual(findField(first, 'appid'), {
      type: 'int32',
      name: 'appid',
      value: 3000000000 | 0
    })
    const third = (entries[2] as { fields: BinaryVdfField[] }).fields
    assert.deepEqual(findField(third, 'AppName'), { type: 'string', name: 'appname', value: 'Odd' })
    assert.deepEqual(findField(third, 'colour'), {
      type: 'fixed',
      code: 0x06,
      name: 'colour',
      bytes: Uint8Array.from([0x10, 0x20, 0x30, 0xff])
    })
    assert.equal((findField(third, 'big') as { code: number }).code, 0x07)
  })

  test('keys keep the order of the file, not the order an object would give them', () => {
    // b, then 1, then a: an object would put the integer-like key first.
    const bytes = Uint8Array.from([
      0x01, 0x62, 0x00, 0x78, 0x00, 0x01, 0x31, 0x00, 0x79, 0x00, 0x01, 0x61, 0x00, 0x7a, 0x00, 0x08
    ])
    const fields = readBinaryVdf(bytes)!
    assert.deepEqual(
      fields.map((field) => field.name),
      ['b', '1', 'a']
    )
    assert.deepEqual(writeBinaryVdf(fields), bytes)
  })

  test('float32 and pointer fields are kept with their own type codes', () => {
    const bytes = Uint8Array.from([
      0x03, 0x66, 0x00, 0x00, 0x00, 0x80, 0x3f, 0x04, 0x70, 0x00, 0x01, 0x02, 0x03, 0x04, 0x08
    ])
    const fields = readBinaryVdf(bytes)!
    assert.deepEqual(
      fields.map((field) => (field as { code: number }).code),
      [0x03, 0x04]
    )
    assert.deepEqual(writeBinaryVdf(fields), bytes)
  })

  test('a byte-order mark at the start of a string is kept', () => {
    const bytes = Uint8Array.from([0x01, 0x6e, 0x00, 0xef, 0xbb, 0xbf, 0x41, 0x00, 0x08])
    const fields = readBinaryVdf(bytes)!
    assert.equal((fields[0] as { value: string }).value, '﻿A')
    assert.deepEqual(writeBinaryVdf(fields), bytes)
  })

  test('a list that cannot be written back exactly is null', () => {
    const whole = realShaped()
    for (let length = 0; length < whole.length; length++) {
      // A copy, so no field can be read from bytes past the cut.
      assert.equal(readBinaryVdf(whole.slice(0, length)), null, `cut at ${length}`)
    }
    // Text that is not UTF-8, an unknown type, and bytes after the end.
    assert.equal(readBinaryVdf(Uint8Array.from([0x01, 0x6e, 0x00, 0xff, 0x00, 0x08])), null)
    assert.equal(readBinaryVdf(Uint8Array.from([0x09, 0x61, 0x00, 0x08])), null)
    assert.equal(readBinaryVdf(Uint8Array.from([...whole, 0x08])), null)
  })

  test('nesting past what Steam writes is null rather than a deep recursion', () => {
    let nested: Record<string, Field> = { leaf: 'x' }
    for (let i = 0; i < 40; i++) nested = { m: nested }
    assert.equal(readBinaryVdf(binaryVdf(nested)), null)
  })

  test('an appid is written the same from its signed and its unsigned reading', () => {
    const signed = writeBinaryVdf([{ type: 'int32', name: 'appid', value: 3000000000 | 0 }])
    const unsigned = writeBinaryVdf([{ type: 'int32', name: 'appid', value: 3000000000 }])
    assert.deepEqual(signed, unsigned)
    assert.deepEqual(readBinaryVdf(unsigned), [
      { type: 'int32', name: 'appid', value: 3000000000 | 0 }
    ])
  })

  test('a field Steam could not read back as written is refused', () => {
    const refused: BinaryVdfField[][] = [
      [{ type: 'string', name: 'a', value: 'x\0y' }],
      [{ type: 'string', name: 'a\0', value: 'x' }],
      [{ type: 'string', name: 'a', value: '\ud800' }],
      [{ type: 'int32', name: 'a', value: 2 ** 32 }],
      [{ type: 'int32', name: 'a', value: -(2 ** 31) - 1 }],
      [{ type: 'int32', name: 'a', value: 1.5 }],
      [{ type: 'fixed', code: 0x07, name: 'a', bytes: new Uint8Array(4) }],
      [{ type: 'fixed', code: 0x09, name: 'a', bytes: new Uint8Array(4) }]
    ]
    for (const fields of refused) {
      assert.throws(() => writeBinaryVdf(fields), RangeError, JSON.stringify(fields[0]))
    }
  })

  test('a field added to a map is written after the others, which stay as they were', () => {
    const bytes = binaryVdf({ shortcuts: { '0': steamShortcut(3000000000, 'RetroArch') } })
    const fields = readBinaryVdf(bytes)!
    const list = findField(fields, 'shortcuts') as { fields: BinaryVdfField[] }
    list.fields.push({ type: 'map', name: '1', fields: readBinaryVdf(binaryVdf({ x: 'y' }))! })
    const written = writeBinaryVdf(fields)
    const expected = binaryVdf({
      shortcuts: { '0': steamShortcut(3000000000, 'RetroArch'), '1': { x: 'y' } }
    })
    assert.deepEqual(written, expected)
  })
})
