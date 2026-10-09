import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkBody } from './pr-body.mjs'

/**
 * A pull request that does not say what it is for cannot be checked against
 * an acceptance line, so CI refuses it. Each test is a body that should or
 * should not get through.
 */

const known = new Set(['M0-05', 'M0-18'])
const script = join(dirname(fileURLToPath(import.meta.url)), 'pr-body.mjs')

describe('the pull-request body check', () => {
  test('a body naming a known feature passes, alone or with others', () => {
    assert.deepEqual(checkBody('Intro\n\nFeature: M0-18 (part 1 of 2)\n', 'someone', known), [])
    assert.deepEqual(checkBody('Feature: M0-05, M0-18', 'someone', known), [])
  })

  test('work outside the list passes when it says why', () => {
    assert.deepEqual(checkBody('Feature: none (flaky fix, #44)', 'someone', known), [])
    assert.match(checkBody('Feature: none', 'someone', known)[0], /without saying why/)
  })

  test('no line, an empty line, or an unknown id fails', () => {
    assert.match(checkBody('Just a change', 'someone', known)[0], /no "Feature: <id>" line/)
    assert.match(checkBody(undefined, 'someone', known)[0], /no "Feature: <id>" line/)
    assert.match(checkBody('Feature: soon', 'someone', known)[0], /names no feature id/)
    assert.deepEqual(checkBody('Feature: M9-99', 'someone', known), [
      'M9-99 is not a feature in docs/features.json'
    ])
  })

  test("a feature mentioned in passing is not the line, and Dependabot's bodies are exempt", () => {
    assert.equal(checkBody('This touches M0-18.', 'someone', known).length, 1)
    assert.deepEqual(checkBody('Bumps electron', 'dependabot[bot]', known), [])
  })

  test('as CI runs it: exit 1 with the reason, exit 0 on a good body', () => {
    const run = (body: string) =>
      spawnSync(process.execPath, [script], {
        env: { ...process.env, PR_BODY: body, PR_AUTHOR: 'someone' },
        encoding: 'utf8'
      })
    const bad = run('Nothing here')
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /pr-body: the body has no "Feature: <id>" line/)
    assert.equal(run('Feature: M0-18').status, 0)
  })
})
