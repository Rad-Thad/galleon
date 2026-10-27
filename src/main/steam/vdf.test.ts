import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { block, field, parseVdf, text } from './vdf.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/steam/${name}`, import.meta.url), 'utf8')

describe('parseVdf', () => {
  test('reads a library list as Steam writes it, nested blocks and all', () => {
    const file = parseVdf(fixture('libraryfolders.vdf'))
    assert.ok(file)
    const card = block(block(file, 'libraryfolders')!, '1')!
    assert.equal(text(card, 'path'), '/run/media/deck/NovaSD')
    assert.deepEqual(block(card, 'apps'), { '413150': '681574400', '105600': '0' })
  })

  test('reads escapes inside quoted strings', () => {
    const file = parseVdf(fixture('appmanifest_413150.acf'))!
    assert.equal(
      text(block(file, 'AppState')!, 'name'),
      'Stardew Valley: "Collector\'s" \\ Edition'
    )
    assert.equal(text(parseVdf('"a" "x\\ty\\nz"')!, 'a'), 'x\ty\nz')
  })

  test('an unknown escape is kept as written, as a Windows path needs', () => {
    assert.equal(text(parseVdf('"path" "D:\\Games"')!, 'path'), 'D:\\Games')
  })

  test('skips comments and platform conditions', () => {
    const file = parseVdf('// header\n"a" { "b" "1" [$WIN32] // trailing\n "c" "2" }')
    assert.deepEqual(file, { a: { b: '1', c: '2' } })
  })

  test('reads unquoted words', () => {
    assert.deepEqual(parseVdf('root { key value }'), { root: { key: 'value' } })
  })

  test('a later duplicate key wins', () => {
    assert.deepEqual(parseVdf('"a" "1" "a" "2"'), { a: '2' })
  })

  test('a key named __proto__ is an ordinary key', () => {
    const file = parseVdf('"__proto__" { "polluted" "1" }')!
    assert.equal(Object.getPrototypeOf(file), Object.prototype)
    assert.deepEqual(Object.keys(file), ['__proto__'])
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  test('a file cut short is malformed, not half read', () => {
    assert.equal(parseVdf(fixture('appmanifest_105600.acf')), null)
    assert.equal(parseVdf('"a" "unterminated'), null)
    assert.equal(parseVdf('"a"'), null)
    assert.equal(parseVdf('"a" { "b" }'), null)
    assert.equal(parseVdf('"a" "1" }'), null)
    assert.equal(parseVdf('"a" { "b" "1" [$WIN32'), null)
    assert.equal(parseVdf('{ "a" "1" }'), null)
  })

  test('an empty file has no pairs', () => {
    assert.deepEqual(parseVdf(''), {})
    assert.deepEqual(parseVdf('  // nothing\n'), {})
  })
})

describe('field', () => {
  const file = { LibraryFolders: { '1': '/x' }, name: 'n' }

  test('finds a key whatever its case', () => {
    assert.deepEqual(field(file, 'libraryfolders'), { '1': '/x' })
    assert.equal(field(file, 'NAME'), 'n')
    assert.equal(field(file, 'missing'), undefined)
  })

  test('text and block return only their own kind', () => {
    assert.equal(text(file, 'LibraryFolders'), undefined)
    assert.equal(block(file, 'name'), undefined)
  })
})
