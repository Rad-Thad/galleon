#!/usr/bin/env node
//
// The pull-request body check in CI's `build` job (M0-18): every pull request
// says which feature it serves, so PROGRESS.md, the evaluator and a later
// session can tie the change to its acceptance lines. Work outside the list
// (a flaky test, a plan edit) says so with `Feature: none` and why.
//
// Reads the body and author from the environment CI sets (PR_BODY, PR_AUTHOR)
// and docs/features.json; changes nothing.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Authors whose bodies nobody here writes. Dependabot's are generated and
 * cannot be edited to carry the line; its pull requests are triaged by hand
 * (CLAUDE.md, rail 8).
 */
const GENERATED = new Set(['dependabot[bot]'])

/** Problems with a body: none when it has a usable `Feature:` line. */
export function checkBody(body, author, knownIds) {
  if (GENERATED.has(author)) return []
  const lines = (body ?? '').split(/\r?\n/).filter((line) => /^\s*Feature:/.test(line))
  if (lines.length === 0)
    return [
      'the body has no "Feature: <id>" line (or "Feature: none (<why>)" for work outside docs/features.json)'
    ]
  const problems = []
  for (const line of lines) {
    const value = line.replace(/^\s*Feature:\s*/, '')
    if (/^none\b/i.test(value)) {
      if (!/^none\s*\(.+\)/i.test(value))
        problems.push(`"${line.trim()}" says none without saying why`)
      continue
    }
    const ids = value.match(/\bM\d+-\d+\b/g) ?? []
    if (ids.length === 0) problems.push(`"${line.trim()}" names no feature id`)
    for (const id of ids)
      if (!knownIds.has(id)) problems.push(`${id} is not a feature in docs/features.json`)
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const features = JSON.parse(
    readFileSync(new URL('../../docs/features.json', import.meta.url), 'utf8')
  )
  const ids = new Set(features.map((feature) => feature.id))
  const problems = checkBody(process.env.PR_BODY, process.env.PR_AUTHOR, ids)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`pr-body: ${problem}`)
    process.exit(1)
  }
  console.log('pr-body: the body names its feature')
}
