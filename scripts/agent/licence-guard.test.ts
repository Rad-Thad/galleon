import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  COPIED_MARKERS,
  checkCopied,
  checkDirect,
  checkTree,
  licenceAllowed,
  licenceOf,
  runtimeRows
} from './licence-guard.mjs'

/**
 * The guard is the only thing standing between a GPL package, or an unrecorded
 * one, and the MIT AppImage (CLAUDE.md, rails 4 and 8). Each test is a way a
 * pull request could slip one past it.
 */

const table = (rows: string) => `# Dependencies

## CI only

| Name | Version | Licence | Why |
| ---- | ------- | ------- | --- |
| \`some/action\` | v1 | GPL-3.0 | Not shipped |

## Runtime

| Name | Version | Licence | Why |
| ---- | ------- | ------- | --- |
${rows}
`

describe('the licence guard', () => {
  test('permissive licences pass, the GPL family and the unnamed do not', () => {
    for (const ok of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', '(MIT OR GPL-3.0)'])
      assert.equal(licenceAllowed(ok), true, ok)
    for (const bad of [
      'GPL-3.0',
      'GPL-2.0-only',
      'LGPL-2.1',
      'AGPL-3.0-or-later',
      'MIT AND GPL-3.0',
      'UNLICENSED',
      '',
      null
    ])
      assert.equal(licenceAllowed(bad), false, String(bad))
  })

  test('a licence is read from either of the shapes package.json has used', () => {
    assert.equal(licenceOf({ license: 'MIT' }), 'MIT')
    assert.equal(licenceOf({ license: { type: 'ISC' } }), 'ISC')
    assert.equal(
      licenceOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }),
      'MIT OR Apache-2.0'
    )
    assert.equal(licenceOf({}), null)
  })

  test('a new runtime dependency without a row fails, and the fork point does not', () => {
    const rows = runtimeRows(table(''))
    assert.deepEqual(checkDirect({ yauzl: '^3.4.0' }, rows), [])
    const problems = checkDirect({ 'left-pad': '1.3.0' }, rows)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /left-pad: a runtime dependency with no row/)
  })

  test('the CI-only table does not count as a runtime row', () => {
    assert.match(checkDirect({ 'some/action': 'v1' }, runtimeRows(table('')))[0], /no row/)
  })

  test('a row must give the exact version, a permitted licence and a reason', () => {
    const rows = runtimeRows(table('| `left-pad` | 1.3.0 | GPL-3.0 |  |'))
    const problems = checkDirect({ 'left-pad': '^1.3.0' }, rows)
    assert.equal(problems.length, 3)
    assert.match(problems[0], /not an exact version/)
    assert.match(problems[1], /GPL-3.0/)
    assert.match(problems[2], /no reason/)
    assert.match(
      checkDirect({ 'left-pad': '1.3.1' }, rows)[0],
      /says 1\.3\.0, package\.json 1\.3\.1/
    )
  })

  test('a recorded, pinned, permissive dependency passes', () => {
    const rows = runtimeRows(table('| `left-pad` | 1.3.0 | MIT | Pads |'))
    assert.deepEqual(checkDirect({ 'left-pad': '1.3.0' }, rows), [])
  })

  test('a GPL package anywhere in the production tree fails', () => {
    const problems = checkTree([
      { name: 'react', version: '19.3.0', licence: 'MIT' },
      { name: 'deep', version: '1.0.0', licence: 'LGPL-3.0' },
      { name: 'bare', version: '2.0.0', licence: null }
    ])
    assert.deepEqual(problems, [
      'deep@1.0.0: licence "LGPL-3.0" may not ship in the AppImage',
      'bare@2.0.0: licence "none" may not ship in the AppImage'
    ])
  })

  test('copied GPL text is found in code, and not in docs or licence files', () => {
    for (const marker of COPIED_MARKERS) {
      const text = `// ${marker}\n`
      assert.equal(checkCopied([{ path: 'src/main/thing.ts', text }]).length, 1, marker)
      assert.deepEqual(checkCopied([{ path: 'docs/research/argosy.md', text }]), [])
      assert.deepEqual(checkCopied([{ path: 'shaders/LICENSE.txt', text }]), [])
    }
  })

  test("the repository's own DEPENDENCIES.md has a runtime table to add to", () => {
    const markdown = readFileSync(new URL('../../docs/DEPENDENCIES.md', import.meta.url), 'utf8')
    assert.match(markdown, /^## Runtime$/m)
    assert.deepEqual(checkDirect({ yauzl: '^3.4.0' }, runtimeRows(markdown)), [])
  })
})
