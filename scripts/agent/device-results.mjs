#!/usr/bin/env node
//
// What the Nova said since the last session read it, and what that changes in
// the plan (CLAUDE.md, "Device results"; docs/TESTING.md, "How a device
// feature passes").
//
// `--summary` prints, in the order a session must act on them: safety
// failures, checks that newly fail, checks that newly pass with the features
// they complete, new problem reports and acceptance results, and how long ago
// the bridge was last seen. `--apply` also makes the changes: `passes` flips
// in docs/features.json, one `regression` issue per feature that failed again
// and per failed safety check, and the PROGRESS.md lines that record it all.
//
// "Since the last session" is every result whose commit no
// `DEVICE-RESULTS <sha> <status>` line in docs/PROGRESS.md names yet.
//
// device-results is the bridge's branch: this reads it and never writes it.
// The rules are pure functions over plain data, so the tests can feed them
// fixtures; the command at the bottom gathers that data from git.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  COUNTING_STATUSES,
  SAFETY_CHECKS,
  deviceChecks,
  readyIsAncestor
} from './features-check.mjs'

const FAILING = ['fail', 'error']

/** The commits PROGRESS.md records as ingested. */
export function ingestedShas(progress) {
  return new Set([...progress.matchAll(/\bDEVICE-RESULTS ([0-9a-f]{40})\b/g)].map((m) => m[1]))
}

function resultsOf(summary) {
  return new Map((summary?.checks ?? []).map((check) => [check.id, check]))
}

function counts(summary) {
  return COUNTING_STATUSES.includes(summary?.status)
}

/** `2026-10-09T08:52:40Z` → `20261009T085240Z`, the bridge's report folder names. */
function compact(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '')
}

/**
 * Everything the results new since the last ingestion mean, oldest first:
 *
 * - `fresh`: the new results, as `{sha, status, finishedAt}`;
 * - `safety`: every `safety.*` check that failed in one, whatever its status;
 * - `regressions`: checks failing in a counting run that passed in the
 *   counting run before it, with the features that name them;
 * - `newPasses`: checks passing that did not before, likewise;
 * - `flips`: device features that now pass (docs/TESTING.md, step 3);
 * - `reverts`: device features that passed and whose check failed on a later
 *   build;
 * - `changes`: the `passes` value each touched feature ends on, when it
 *   differs from where it started;
 * - `reports`, `acceptance`: folders newer than the last ingested result;
 * - `bridge`: when it was last seen, by its status or its newest result, and
 *   why it last skipped.
 *
 * `index` is `results/index.json` (newest first), `summaries` maps a sha to
 * its summary (absent when pruned), `readyIsAncestor(id, sha)` answers the
 * ancestry rule, and is asked only when everything else already holds.
 */
export function analyse({
  features,
  index,
  summaries,
  progress,
  reports = [],
  acceptance = [],
  status = null,
  now,
  readyIsAncestor: isAncestor
}) {
  const ingested = ingestedShas(progress)
  const entries = (Array.isArray(index) ? index : []).filter((e) => typeof e?.sha === 'string')
  const fresh = entries.filter((e) => !ingested.has(e.sha)).toReversed()
  const lastIngested = entries.find((e) => ingested.has(e.sha)) ?? null

  const device = features.filter((f) => f.verification === 'device')
  const state = new Map(device.map((f) => [f.id, Boolean(f.passes)]))
  const naming = (check) => features.filter((f) => deviceChecks(f).includes(check)).map((f) => f.id)

  // The counting run each fresh one is compared with: the nearest older one.
  const older = (entry) => {
    for (const e of entries.slice(entries.indexOf(entry) + 1)) {
      const summary = summaries.get(e.sha)
      if (counts(summary)) return resultsOf(summary)
    }
    return new Map()
  }

  const out = {
    fresh: fresh.map(({ sha, status: s, finishedAt }) => ({ sha, status: s, finishedAt })),
    safety: [],
    regressions: [],
    newPasses: [],
    flips: [],
    reverts: [],
    changes: [],
    reports: [],
    acceptance: [],
    bridge: null
  }

  for (const entry of fresh) {
    const { sha } = entry
    const summary = summaries.get(sha) ?? null
    const results = resultsOf(summary)
    const unsafe = [...results.values()].filter(
      (check) => check.id.startsWith('safety.') && FAILING.includes(check.result)
    )
    for (const check of unsafe)
      out.safety.push({ sha, id: check.id, result: check.result, reason: check.reason ?? null })
    if (!counts(summary)) continue

    const before = older(entry)
    for (const check of results.values()) {
      const was = before.get(check.id)?.result ?? null
      if (FAILING.includes(check.result) && was === 'pass')
        out.regressions.push({
          sha,
          id: check.id,
          result: check.result,
          features: naming(check.id)
        })
      if (check.result === 'pass' && was !== 'pass')
        out.newPasses.push({ sha, id: check.id, features: naming(check.id) })
    }

    const safe =
      unsafe.length === 0 && SAFETY_CHECKS.every((id) => results.get(id)?.result === 'pass')
    for (const feature of device) {
      const checks = deviceChecks(feature)
      if (checks.length === 0) continue
      if (state.get(feature.id)) {
        const failed = checks.filter((id) => FAILING.includes(results.get(id)?.result))
        if (failed.length === 0) continue
        state.set(feature.id, false)
        out.reverts.push({
          id: feature.id,
          sha,
          checks: failed.map((id) => ({
            id,
            result: results.get(id).result,
            reason: results.get(id).reason ?? null
          }))
        })
      } else if (
        safe &&
        checks.every((id) => results.get(id)?.result === 'pass') &&
        isAncestor(feature.id, sha)
      ) {
        state.set(feature.id, true)
        out.flips.push({ id: feature.id, sha })
      }
    }
  }

  for (const feature of device)
    if (state.get(feature.id) !== Boolean(feature.passes))
      out.changes.push({ id: feature.id, passes: state.get(feature.id) })

  const since = lastIngested?.finishedAt ?? null
  out.reports = [...reports].sort().filter((name) => since === null || name > compact(since))
  out.acceptance = [...acceptance]
    .sort()
    .filter((date) => since === null || date >= since.slice(0, 10))

  // The newest of the two sightings: the bridge writes its status only when
  // it skips (see `maybe_heartbeat` in tools/device-bridge), so one testing
  // every night is seen through its results alone.
  const sightings = [
    typeof status?.lastSeen === 'string' ? status.lastSeen : null,
    ...entries.map((e) => (typeof e.finishedAt === 'string' ? e.finishedAt : null))
  ].filter((at) => at !== null && Number.isFinite(Date.parse(at)))
  const lastSeen = sightings.reduce(
    (newest, at) => (newest === null || Date.parse(at) > Date.parse(newest) ? at : newest),
    null
  )
  if (lastSeen !== null) {
    const hours = (Date.parse(now) - Date.parse(lastSeen)) / 3_600_000
    out.bridge = {
      lastSeen,
      hours: Number.isFinite(hours) ? hours : null,
      lastSkip: status?.lastSkip ?? null,
      version: status?.bridgeVersion ?? null
    }
  }
  return out
}

function short(sha) {
  return sha.slice(0, 7)
}

function list(items, line) {
  return items.length === 0 ? ['  none'] : items.map((item) => `  ${line(item)}`)
}

function featuresNote(ids) {
  return ids.length > 0 ? ` (${ids.join(', ')})` : ''
}

/** The `--summary` text, in the order a session acts on it. */
export function render(analysis) {
  const a = analysis
  const lines = []
  lines.push(`New results since the last ingestion: ${a.fresh.length}`)
  for (const r of a.fresh)
    lines.push(`  ${short(r.sha)} ${r.status} ${r.finishedAt ?? ''}`.trimEnd())
  lines.push(a.safety.length > 0 ? 'SAFETY FAILURES (feature work stops):' : 'Safety failures:')
  lines.push(
    ...list(
      a.safety,
      (s) => `${s.id} ${s.result} on ${short(s.sha)}${s.reason ? `: ${s.reason}` : ''}`
    )
  )
  lines.push('Newly failing (regressions):')
  lines.push(
    ...list(
      a.regressions,
      (r) => `${r.id} ${r.result} on ${short(r.sha)}${featuresNote(r.features)}`
    )
  )
  lines.push(...a.reverts.map((r) => `  -> ${r.id} goes back to false (${short(r.sha)})`))
  lines.push('Newly passing:')
  lines.push(...list(a.newPasses, (p) => `${p.id} on ${short(p.sha)}${featuresNote(p.features)}`))
  lines.push(...a.flips.map((f) => `  -> ${f.id} passes: PASSES ${f.id} device:${f.sha}`))
  lines.push('New problem reports:')
  lines.push(...list(a.reports, (name) => `reports/${name}/`))
  if (a.acceptance.length > 0) {
    lines.push('Acceptance results:')
    lines.push(...list(a.acceptance, (date) => `acceptance/${date}/`))
  }
  lines.push(
    a.bridge === null
      ? 'Bridge: never seen'
      : `Bridge: last seen ${a.bridge.hours === null ? '?' : a.bridge.hours.toFixed(1)} h ago (${a.bridge.lastSeen}), version ${a.bridge.version ?? '?'}${a.bridge.lastSkip ? `, last skip: ${a.bridge.lastSkip}` : ''}`
  )
  return lines.join('\n')
}

/** The lines `--apply` asks the session's PROGRESS.md entry to carry. */
export function progressLines(analysis) {
  const passing = new Set(analysis.changes.filter((c) => c.passes).map((c) => c.id))
  return [
    ...analysis.fresh.map((r) => `DEVICE-RESULTS ${r.sha} ${r.status}`),
    ...analysis.flips.filter((f) => passing.has(f.id)).map((f) => `PASSES ${f.id} device:${f.sha}`)
  ]
}

/**
 * `features.json` with one feature's `passes` set, and every other byte as it
 * was, so the diff a flip makes is that one word.
 */
export function setPasses(text, id, passes) {
  const at = text.indexOf(`"id": ${JSON.stringify(id)}`)
  if (at < 0) throw new Error(`${id} is not in features.json`)
  const rest = text.slice(at)
  const flag = /"passes": (true|false)/.exec(rest)
  if (!flag) throw new Error(`${id} has no passes flag`)
  const start = at + flag.index
  return `${text.slice(0, start)}"passes": ${passes}${text.slice(start + flag[0].length)}`
}

/** The title a regression issue carries, by which an open one is found again. */
export function regressionTitle(subject) {
  return `[regression] ${subject}`
}

/**
 * The regression issues to open: one per feature that went back to false and
 * one per safety check that failed, minus those already open. A subject named
 * by several results gets one issue, about its newest failure.
 */
export function issuesToOpen(analysis, openTitles) {
  const open = new Set(openTitles)
  const wanted = new Map()
  for (const r of analysis.reverts)
    wanted.set(r.id, {
      title: regressionTitle(r.id),
      labels: ['regression'],
      body: [
        `${r.id} passed on an earlier device result and fails on ${r.sha}:`,
        '',
        ...r.checks.map((c) => `- \`${c.id}\`: ${c.result}${c.reason ? ` (${c.reason})` : ''}`),
        '',
        `Its \`passes\` flag is set back to false. Reproduce with a unit or app test against fakes, fix it before new features (CLAUDE.md, "Device results").`
      ].join('\n')
    })
  for (const s of analysis.safety)
    wanted.set(s.id, {
      title: regressionTitle(s.id),
      labels: ['regression', 'save-sync'],
      body: [
        `\`${s.id}\` was ${s.result} on the device run for ${s.sha}${s.reason ? `: ${s.reason}` : '.'}`,
        '',
        'A failed safety check stops feature work until it is understood and fixed (CLAUDE.md, rail 3).'
      ].join('\n')
    })
  return [...wanted.values()].filter((issue) => !open.has(issue.title))
}

// ---------------------------------------------------------------------------
// Reading git. Only `fetch`, `ls-tree`, `cat-file`, `log` and `merge-base`:
// nothing here can write the branch it reads.

function gitIn(cwd, args, input) {
  return execFileSync('git', args, {
    cwd,
    input,
    ...(input === undefined ? { encoding: 'utf8' } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024
  })
}

/** Many `<ref>:<path>` blobs through one `git cat-file --batch`. */
function readBlobs(cwd, specs) {
  if (specs.length === 0) return new Map()
  const out = gitIn(cwd, ['cat-file', '--batch'], `${specs.join('\n')}\n`)
  const blobs = new Map()
  let at = 0
  for (const spec of specs) {
    const end = out.indexOf(10, at)
    const header = out.subarray(at, end).toString('utf8')
    at = end + 1
    if (header.endsWith(' missing')) continue
    const size = Number(header.split(' ')[2])
    blobs.set(spec, out.subarray(at, at + size).toString('utf8'))
    at += size + 1
  }
  return blobs
}

function parse(text) {
  try {
    return text === undefined ? null : JSON.parse(text)
  } catch {
    return null
  }
}

/** Everything `analyse` needs from the device-results branch at `ref`. */
export function readBranch(cwd, ref) {
  const names = gitIn(cwd, ['ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean)
  const folders = (prefix) => [
    ...new Set(
      names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length).split('/')[0])
    )
  ]
  const shas = names
    .map((n) => /^results\/([0-9a-f]{40})\/summary\.json$/.exec(n)?.[1])
    .filter(Boolean)
  const specs = [
    `${ref}:results/index.json`,
    `${ref}:bridge/status.json`,
    ...shas.map((sha) => `${ref}:results/${sha}/summary.json`)
  ]
  const blobs = readBlobs(cwd, specs)
  return {
    index: parse(blobs.get(specs[0])) ?? [],
    status: parse(blobs.get(specs[1])),
    summaries: new Map(
      shas.map((sha) => [sha, parse(blobs.get(`${ref}:results/${sha}/summary.json`))])
    ),
    reports: folders('reports/'),
    acceptance: folders('acceptance/')
  }
}

function gh(args, input) {
  return execFileSync('gh', ['api', ...args], { input, encoding: 'utf8' })
}

function repoName(cwd) {
  const remote = gitIn(cwd, ['remote', 'get-url', 'origin']).trim()
  return remote.replace(/\.git$/, '').replace(/.*[/:]([^/]+\/[^/]+)$/, '$1')
}

function main(argv) {
  const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
  const root = option('--root', fileURLToPath(new URL('../../', import.meta.url)))
  const ref = option('--ref', 'origin/device-results')
  const apply = argv.includes('--apply')
  if (!apply && !argv.includes('--summary')) {
    console.error('usage: device-results.mjs --summary | --apply [--no-fetch] [--no-issues]')
    process.exit(2)
  }
  if (!argv.includes('--no-fetch'))
    try {
      gitIn(root, ['fetch', '-q', 'origin', 'device-results', 'main'])
    } catch {
      console.error('device-results: could not fetch; reading what is already here')
    }

  let branch
  try {
    branch = readBranch(root, ref)
  } catch {
    console.log(`No device results yet (${ref} cannot be read).`)
    return
  }
  const featuresPath = join(root, 'docs/features.json')
  const featuresText = readFileSync(featuresPath, 'utf8')
  const analysis = analyse({
    ...branch,
    features: JSON.parse(featuresText),
    progress: readFileSync(join(root, 'docs/PROGRESS.md'), 'utf8'),
    now: new Date().toISOString(),
    readyIsAncestor: (id, sha) => readyIsAncestor(id, sha, root)
  })
  console.log(render(analysis))
  if (!apply) return

  let text = featuresText
  for (const change of analysis.changes) text = setPasses(text, change.id, change.passes)
  if (text !== featuresText) writeFileSync(featuresPath, text)
  for (const change of analysis.changes)
    console.log(`docs/features.json: ${change.id} passes ${change.passes}`)

  if (!argv.includes('--no-issues')) {
    const repo = repoName(root)
    const open = JSON.parse(
      gh([`repos/${repo}/issues?state=open&labels=regression&per_page=100`])
    ).map((issue) => issue.title)
    for (const issue of issuesToOpen(analysis, open)) {
      const number = JSON.parse(
        gh(['--method', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify(issue))
      ).number
      console.log(`opened #${number} ${issue.title}`)
    }
  }
  const lines = progressLines(analysis)
  if (lines.length > 0) {
    console.log("\nFor this session's PROGRESS.md entry:")
    for (const line of lines) console.log(`- ${line}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
