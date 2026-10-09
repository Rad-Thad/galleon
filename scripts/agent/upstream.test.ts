import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { baseSha, body, plan, run, title, type Compare, type Issue } from './upstream.mjs'

/**
 * The upstream watch is how useful RomMix fixes are found (docs/UPSTREAM.md).
 * A watch that opens a new issue every week buries the list, and one that
 * writes anywhere but this repository's issues breaks the rule that upstream
 * is only read, so both are held here against a recorded API.
 */

const BASE = 'ea787b98c32ce6efcd0c0448c0dac5aed074f3af'

function commit(n: number, message: string): NonNullable<Compare['commits']>[number] {
  const sha = String(n).repeat(40).slice(0, 40)
  return {
    sha,
    html_url: `https://github.com/leclercb/rommix/commit/${sha}`,
    commit: { message, author: { date: `2026-10-0${n}T12:00:00Z` } }
  }
}

const COMPARE: Compare = {
  html_url: `https://github.com/leclercb/rommix/compare/${BASE}...main`,
  total_commits: 2,
  commits: [commit(1, 'fix: list controllers\n\nLonger body.'), commit(2, 'feat: something')]
}

function issue(fields: Partial<Issue>): Issue {
  return { number: 7, title: 'upstream: 1 new commit', body: '', state: 'open', ...fields }
}

describe('the upstream watch', () => {
  test('reads the base commit from docs/UPSTREAM.md', () => {
    const markdown = readFileSync(new URL('../../docs/UPSTREAM.md', import.meta.url), 'utf8')
    assert.equal(baseSha(markdown), BASE)
    assert.equal(baseSha('# Upstream\n'), null)
  })

  test('lists every commit since the base with its link, subject and date', () => {
    const text = body(BASE, COMPARE)
    assert.match(text, /since the base `ea787b9` recorded in docs\/UPSTREAM\.md/)
    assert.match(
      text,
      /- \[`1111111`\]\(https:\/\/github\.com\/leclercb\/rommix\/commit\/1{40}\) fix: list controllers \(2026-10-01\)\n- \[`2222222`\]/
    )
    assert.doesNotMatch(text, /Longer body/)
    assert.equal(title(2), 'upstream: 2 new commits')
    assert.equal(title(1), 'upstream: 1 new commit')
  })

  test('a range longer than the list the API returns says how many more there are', () => {
    assert.match(
      body(BASE, { ...COMPARE, total_commits: 300 }),
      /…and 298 more; see the compare link\./
    )
  })

  test('opens one issue when there is something new and none is open', () => {
    const step = plan(BASE, COMPARE, [])
    assert.equal(step.action, 'open')
    assert.deepEqual(step.action === 'open' && [step.title, step.labels], [
      'upstream: 2 new commits',
      ['upstream']
    ])
  })

  test('updates the open issue rather than opening another, and leaves it when nothing changed', () => {
    const step = plan(BASE, COMPARE, [issue({ number: 12 })])
    assert.deepEqual(step.action === 'update' && [step.number, step.title], [
      12,
      'upstream: 2 new commits'
    ])
    const same = issue({ title: title(2), body: body(BASE, COMPARE) })
    assert.deepEqual(plan(BASE, COMPARE, [same]), { action: 'none' })
  })

  test('ignores pull requests, closed issues and other titles, and opens nothing when level', () => {
    const others = [
      issue({ pull_request: {} }),
      issue({ state: 'closed' }),
      issue({ title: 'upstream: port the controller fix' })
    ]
    assert.equal(plan(BASE, COMPARE, others).action, 'open')
    assert.deepEqual(plan(BASE, { total_commits: 0, commits: [] }, []), { action: 'none' })
  })

  test('reads upstream and writes only this repository, never a ref', async () => {
    const calls: [string, string][] = []
    const request = async (method: string, path: string): Promise<unknown> => {
      calls.push([method, path])
      if (path.includes('/compare/')) return COMPARE
      if (method === 'GET') return [issue({ number: 3 })]
      return {}
    }
    const step = await run({ repo: 'Rad-Thad/galleon', base: BASE, request })
    assert.equal(step.action, 'update')
    assert.deepEqual(calls, [
      ['GET', `/repos/leclercb/rommix/compare/${BASE}...main`],
      ['GET', '/repos/Rad-Thad/galleon/issues?state=open&labels=upstream&per_page=100'],
      ['PATCH', '/repos/Rad-Thad/galleon/issues/3']
    ])
  })
})
