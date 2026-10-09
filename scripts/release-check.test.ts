import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { releaseErrors } from './release-check.mjs'

/**
 * A stable release is cut once, by hand, near the end, and cannot be tried
 * beforehand without publishing one: what refuses a wrong version, and what
 * keeps the publish behind the owner's approval, is held here instead.
 */

const ROOT = resolve(import.meta.dirname, '..')
const CHANGELOG = '# Changelog\n\n## 1.0.0 — 2026-11-01\n\n- feat: x\n\n## 0.20.0 — 2026-09-30\n'

describe('releaseErrors', () => {
  test('a version package.json and the changelog both carry is releasable', () => {
    assert.deepEqual(
      releaseErrors({ version: '1.0.0', packageVersion: '1.0.0', changelog: CHANGELOG }),
      []
    )
  })

  test('package.json or the changelog disagreeing is refused, each named', () => {
    assert.deepEqual(
      releaseErrors({ version: '1.0.0', packageVersion: '0.20.0', changelog: CHANGELOG }),
      ['package.json says 0.20.0, not 1.0.0']
    )
    assert.deepEqual(
      releaseErrors({ version: '1.1.0', packageVersion: '1.1.0', changelog: CHANGELOG }),
      ["CHANGELOG.md has no '## 1.1.0' section"]
    )
    assert.equal(
      releaseErrors({ version: '2.0.0', packageVersion: '1.0.0', changelog: CHANGELOG }).length,
      2
    )
  })

  test('a heading only containing the version, or a list item, is not its section', () => {
    const changelog = '## 1.0.0-rc.1\n\n- 1.0.0 is next\n### 1.0.0\n'
    assert.deepEqual(releaseErrors({ version: '1.0.0', packageVersion: '1.0.0', changelog }), [
      "CHANGELOG.md has no '## 1.0.0' section"
    ])
    assert.deepEqual(
      releaseErrors({ version: '1.0.0-rc.1', packageVersion: '1.0.0-rc.1', changelog }),
      []
    )
  })

  test('only a plain or suffixed semver becomes a tag', () => {
    for (const version of [
      'v1.0.0',
      '1.0',
      '1.0.0+build.1',
      '01.0.0',
      '1.0.0 ',
      '',
      '1.0.0-',
      '1.0.0\n2.0.0'
    ]) {
      const errors = releaseErrors({
        version,
        packageVersion: version,
        changelog: `## ${version}\n`
      })
      assert.equal(errors.length, 1, version)
      assert.match(errors[0], /is not a version/)
    }
  })
})

describe('release-check.mjs', () => {
  function run(version: string[], packageVersion: string) {
    const dir = mkdtempSync(join(tmpdir(), 'release-check-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: packageVersion }))
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG)
    return spawnSync(process.execPath, [join(ROOT, 'scripts/release-check.mjs'), ...version], {
      cwd: dir,
      encoding: 'utf8'
    })
  }

  test('exits 0 on agreement, 1 with an annotation per error, 2 without a version', () => {
    assert.equal(run(['1.0.0'], '1.0.0').status, 0)
    const refused = run(['1.0.0'], '0.20.0')
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /^::error::package\.json says 0\.20\.0, not 1\.0\.0$/m)
    assert.equal(run([], '1.0.0').status, 2)
  })
})

/** Each job under `jobs:`, as its block of lines, by name. */
function jobs(path: string) {
  const text = readFileSync(join(ROOT, path), 'utf8')
  const body = text.slice(text.indexOf('\njobs:\n'))
  const found = new Map<string, string>()
  for (const match of body.matchAll(/^ {2}([\w-]+):\n((?: {4}.*\n|\s*\n)*)/gm))
    found.set(match[1], match[2])
  return { text, jobs: found }
}

describe('cut-release.yml', () => {
  const { text, jobs: cut } = jobs('.github/workflows/cut-release.yml')

  test('is started only by hand, with the version, and from main', () => {
    assert.match(text, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}version:\n/m)
    assert.doesNotMatch(text, /^ {2}(push|pull_request|schedule|workflow_call):/m)
    assert.match(cut.get('verify') ?? '', /if: github\.ref == 'refs\/heads\/main'/)
  })

  test('checks the environment, the version and the tag before anything is built', () => {
    const verify = cut.get('verify') ?? ''
    assert.match(verify, /environments\/release/)
    assert.match(verify, /required_reviewers/)
    assert.match(verify, /node scripts\/release-check\.mjs "\$VERSION"/)
    assert.match(verify, /git\/ref\/tags\/v\$VERSION/)
    assert.match(
      cut.get('build') ?? '',
      /needs: verify\n\s+uses: \.\/\.github\/workflows\/release\.yml/
    )
  })

  test('only the job behind the release environment tags or publishes, after the build', () => {
    const publishing = [...cut].filter(([, block]) =>
      /softprops\/action-gh-release|tag_name|git (tag|push)/.test(block)
    )
    assert.deepEqual(
      publishing.map(([name]) => name),
      ['release']
    )
    const release = cut.get('release') ?? ''
    assert.match(release, /needs: \[verify, build\]/)
    assert.match(release, /^ {4}environment: release$/m)
    assert.match(release, /tag_name: v\$\{\{ inputs\.version \}\}/)
    assert.match(release, /target_commitish: \$\{\{ github\.sha \}\}/)
    assert.doesNotMatch(release, /git push/)
  })
})

describe('release.yml', () => {
  const { text, jobs: release } = jobs('.github/workflows/release.yml')

  test('no tag push publishes anything, and a release build publishes no canary', () => {
    assert.doesNotMatch(text, /tags:\s*\n\s*- 'v\*'/)
    assert.match(text, /^ {2}workflow_call:\n {4}inputs:\n {6}version:\n/m)
    assert.deepEqual([...release.keys()], ['build', 'canary'])
    assert.match(
      release.get('canary') ?? '',
      /if: github\.ref == 'refs\/heads\/main' && !inputs\.version/
    )
    assert.doesNotMatch(release.get('build') ?? '', /^ {4}if:/m)
  })
})
