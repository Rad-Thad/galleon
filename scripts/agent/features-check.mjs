#!/usr/bin/env node
//
// The guard on docs/features.json (CLAUDE.md, "Definition of done", item 9).
//
// The feature list is the contract the whole project is accepted against, and
// the agent is the only one editing it. So the list is held to rules a script
// can check rather than to good intentions: its shape, its dependency graph,
// its coverage of every requirement in the research, the catalogue its device
// checks come from, the names `.github/` must never use, and, on a pull
// request, that an existing feature changes only by its `passes` flag and only
// with the evidence its verification type asks for (docs/TESTING.md,
// "Verification types").
//
// The rules are pure functions over plain data, so the tests can feed them
// fixtures; the command at the bottom gathers that data from git.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FIELDS = [
  'id',
  'milestone',
  'title',
  'description',
  'source',
  'acceptance',
  'verification',
  'depends_on',
  'passes'
]

/** What may not change once a feature exists: everything but `passes`. */
const FROZEN = FIELDS.filter((field) => field !== 'id' && field !== 'passes')

const VERIFICATIONS = ['ci', 'agent-screenshot', 'device', 'acceptance']

/** The checks that must pass in the same run as a device feature's own. */
export const SAFETY_CHECKS = ['safety.owner-state', 'safety.server-readonly']

/** Device statuses whose checks count (docs/TESTING.md, "summary.json"). */
export const COUNTING_STATUSES = ['complete', 'partial']

function range(prefix, last) {
  return Array.from({ length: last }, (_, index) => `${prefix}-${index + 1}`)
}

/** Every requirement the research names, each owed at least one feature. */
export const REQUIRED_SOURCES = [
  ...range('REQ', 17),
  ...range('PARITY', 48),
  ...range('BEYOND', 18)
]

/**
 * The `Device check` ids a feature's acceptance names. A line counts when it
 * starts with the fixed prefix, and every check it then names counts, since
 * one line may hold several (`Device check \`a\` and device check \`b\`: ...`).
 */
export function deviceChecks(feature) {
  return (Array.isArray(feature.acceptance) ? feature.acceptance : [])
    .map(String)
    .filter((line) => /^device check `/i.test(line))
    .flatMap((line) => [...line.matchAll(/device check `([^`]+)`/gi)].map((match) => match[1]))
}

/**
 * The check ids in docs/TESTING.md's catalogue table. A `<placeholder>` in an
 * id stands for one concrete segment, as in `launch.<emulator>`.
 */
export function catalogueIds(markdown) {
  const section = markdown.split(/^## Check catalogue\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1])
}

function inCatalogue(id, catalogue) {
  // A feature applied per system names the catalogue's own placeholder id,
  // since its concrete ids come from research done later.
  if (catalogue.includes(id)) return true
  return catalogue.some((entry) => {
    const pattern = entry
      .split(/<[^>]+>/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[a-z0-9-]+')
    return new RegExp(`^${pattern}$`).test(id)
  })
}

function isStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '')
}

function shapeErrors(feature, index) {
  const name = typeof feature?.id === 'string' ? feature.id : `feature #${index}`
  if (feature === null || typeof feature !== 'object' || Array.isArray(feature))
    return [`${name}: is not an object`]
  const errors = []
  for (const field of Object.keys(feature))
    if (!FIELDS.includes(field)) errors.push(`${name}: unknown field "${field}"`)
  for (const field of FIELDS)
    if (!(field in feature)) errors.push(`${name}: missing field "${field}"`)
  for (const field of ['id', 'milestone', 'title', 'description'])
    if (field in feature && (typeof feature[field] !== 'string' || feature[field] === ''))
      errors.push(`${name}: "${field}" must be a non-empty string`)
  for (const field of ['source', 'acceptance'])
    if (field in feature && (!isStringList(feature[field]) || feature[field].length === 0))
      errors.push(`${name}: "${field}" must be a non-empty list of strings`)
  if ('depends_on' in feature && !isStringList(feature.depends_on))
    errors.push(`${name}: "depends_on" must be a list of ids`)
  if ('verification' in feature && !VERIFICATIONS.includes(feature.verification))
    errors.push(
      `${name}: verification "${feature.verification}" is not one of ${VERIFICATIONS.join(', ')}`
    )
  if ('passes' in feature && typeof feature.passes !== 'boolean')
    errors.push(`${name}: "passes" must be true or false`)
  return errors
}

/** One dependency cycle, as the ids along it, or null when there is none. */
function findCycle(features) {
  const edges = new Map(features.map((feature) => [feature.id, feature.depends_on ?? []]))
  const state = new Map()
  const path = []
  const visit = (id) => {
    if (state.get(id) === 'done' || !edges.has(id)) return null
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id]
    state.set(id, 'open')
    path.push(id)
    for (const next of edges.get(id)) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    path.pop()
    state.set(id, 'done')
    return null
  }
  for (const id of edges.keys()) {
    const cycle = visit(id)
    if (cycle) return cycle
  }
  return null
}

/**
 * Everything wrong with the list on its own: shape, ids, dependencies,
 * coverage, and the device checks against the catalogue.
 */
export function validate(features, { catalogue, required = REQUIRED_SOURCES }) {
  if (!Array.isArray(features)) return ['features.json is not a list']
  const errors = features.flatMap(shapeErrors)
  if (errors.length > 0) return errors

  const seen = new Set()
  for (const { id } of features) {
    if (seen.has(id)) errors.push(`${id}: the id is used more than once`)
    seen.add(id)
  }
  for (const feature of features)
    for (const dependency of feature.depends_on)
      if (!seen.has(dependency)) errors.push(`${feature.id}: depends on unknown "${dependency}"`)
  const cycle = findCycle(features)
  if (cycle) errors.push(`depends_on has a cycle: ${cycle.join(' -> ')}`)

  const sources = new Set(features.flatMap((feature) => feature.source))
  for (const item of required)
    if (!sources.has(item)) errors.push(`${item} is not in any feature's source`)

  for (const feature of features) {
    const checks = deviceChecks(feature)
    for (const check of checks)
      if (!inCatalogue(check, catalogue))
        errors.push(
          `${feature.id}: Device check \`${check}\` is not in docs/TESTING.md's catalogue`
        )
    if (feature.verification === 'device' && checks.length === 0)
      errors.push(`${feature.id}: a device feature names no Device check`)
  }
  return errors
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What a pull request did to the features that already existed: every frozen
 * field it changed or feature it removed, as errors, and the ids it flipped
 * to passing, for `flipErrors`.
 */
export function compare(base, head) {
  const byId = new Map(head.map((feature) => [feature.id, feature]))
  const errors = []
  const flipped = []
  for (const before of base) {
    const after = byId.get(before.id)
    if (!after) {
      errors.push(`${before.id}: removed; features are never deleted`)
      continue
    }
    for (const field of FROZEN)
      if (!same(before[field], after[field]))
        errors.push(`${before.id}: "${field}" changed; only "passes" may change on a feature`)
    if (!before.passes && after.passes) flipped.push(after)
  }
  return { errors, flipped }
}

/**
 * Whether each flip to passing carries the evidence its verification type
 * asks for. `evidence` is what the command reads from git:
 *
 * - `progress`: the lines the pull request added to docs/PROGRESS.md;
 * - `summary(sha)`: `results/<sha>/summary.json` on device-results, or null;
 * - `acceptance(date)`: `acceptance/<date>/results.json` there, or null;
 * - `readyIsAncestor(id, sha)`: whether the commit that added
 *   `READY-FOR-DEVICE <id>` to docs/PROGRESS.md is an ancestor of `sha`.
 *
 * A `ci` or `agent-screenshot` flip has its proof in CI and the evaluator,
 * which no file records, so it only has to be named in the added entry.
 */
export function flipErrors(flipped, evidence) {
  const errors = []
  for (const feature of flipped) {
    const { id } = feature
    const quoted = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (feature.verification === 'device') {
      const claim = new RegExp(`PASSES ${quoted} device:([0-9a-f]{40})\\b`).exec(evidence.progress)
      if (!claim) {
        errors.push(`${id}: flipped without "PASSES ${id} device:<sha>" in the PROGRESS entry`)
        continue
      }
      const sha = claim[1]
      const summary = evidence.summary(sha)
      if (!summary) {
        errors.push(`${id}: no results/${sha}/summary.json on device-results`)
        continue
      }
      if (!COUNTING_STATUSES.includes(summary.status))
        errors.push(`${id}: the run for ${sha} is "${summary.status}", which flips nothing`)
      const results = new Map((summary.checks ?? []).map((check) => [check.id, check.result]))
      for (const check of [...deviceChecks(feature), ...SAFETY_CHECKS])
        if (results.get(check) !== 'pass')
          errors.push(`${id}: ${check} is "${results.get(check) ?? 'absent'}" in ${sha}, not pass`)
      if (!evidence.readyIsAncestor(id, sha))
        errors.push(
          `${id}: the commit adding "READY-FOR-DEVICE ${id}" is not an ancestor of ${sha}`
        )
    } else if (feature.verification === 'acceptance') {
      const claim = new RegExp(`PASSES ${quoted} acceptance:(\\d{4}-\\d{2}-\\d{2})\\b`).exec(
        evidence.progress
      )
      if (!claim) {
        errors.push(`${id}: flipped without "PASSES ${id} acceptance:<date>" in the PROGRESS entry`)
        continue
      }
      const items = evidence.acceptance(claim[1])?.items ?? []
      if (!items.some((item) => item.feature === id && item.result === 'pass'))
        errors.push(`${id}: acceptance/${claim[1]}/results.json has no pass for it`)
    } else if (!new RegExp(`\\b${quoted}\\b`).test(evidence.progress)) {
      errors.push(`${id}: flipped without being named in the PROGRESS entry`)
    }
  }
  return errors
}

/**
 * Names that belong to the earlier plan's dispatch trigger and tester sign-in.
 * Nothing in `.github/` may use them: there is no Routine trigger and no
 * repository secret (M0-16), so a reference is either dead or a way in.
 */
export const FORBIDDEN_IN_GITHUB = ['ROUTINE_FIRE_URL', 'ROUTINE_FIRE_TOKEN', 'TESTER_LOGIN']

/** Every file under `.github/` that names one of `FORBIDDEN_IN_GITHUB`. */
export function forbiddenNames(files) {
  return files.flatMap(({ path, text }) =>
    FORBIDDEN_IN_GITHUB.filter((name) => text.includes(name)).map(
      (name) => `${path}: names ${name}; nothing in .github/ may`
    )
  )
}

/**
 * How long before a pull request opens its PROGRESS.md entry may be dated. The
 * entry is written in the session that opens the pull request, before it does,
 * and a session is as long as the concurrency lock lets one run (CLAUDE.md).
 */
export const PROGRESS_GRACE_HOURS = 3

/** Authors whose pull requests nobody here writes, and so carry no entry. */
const GENERATED_AUTHORS = new Set(['dependabot[bot]'])

const ENTRY_HEADING = /^## (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) UTC session /

/**
 * A pull request appends a PROGRESS.md entry dated within its lifetime: from
 * the session that opened it until the check runs (M0-18). `added` is what it
 * added to the file; `opened` and `now` are ISO timestamps.
 */
export function progressEntryErrors(added, { opened, now, author }) {
  if (GENERATED_AUTHORS.has(author)) return []
  const earliest = Date.parse(opened) - PROGRESS_GRACE_HOURS * 3_600_000
  // Headings are written to the minute, so the minute being checked counts.
  const latest = Date.parse(now) + 60_000
  const dates = added
    .split('\n')
    .map((line) => ENTRY_HEADING.exec(line))
    .filter(Boolean)
    .map(([, day, hour, minute]) => Date.parse(`${day}T${hour}:${minute}:00Z`))
  if (dates.length === 0)
    return [
      'docs/PROGRESS.md gains no "## <YYYY-MM-DD HH:MM> UTC session" entry in this pull request'
    ]
  if (!dates.some((date) => date >= earliest && date <= latest))
    return [
      `no PROGRESS.md entry this pull request adds is dated between ${new Date(earliest).toISOString()} and ${new Date(now).toISOString()}`
    ]
  return []
}

/** Lines of `after` that `before` does not have: what an append-only file gained. */
export function addedLines(before, after) {
  const left = new Map()
  for (const line of before.split('\n')) left.set(line, (left.get(line) ?? 0) + 1)
  return after
    .split('\n')
    .filter((line) => {
      const count = left.get(line) ?? 0
      if (count === 0) return true
      left.set(line, count - 1)
      return false
    })
    .join('\n')
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function tryGit(...args) {
  try {
    return git(...args)
  } catch {
    return null
  }
}

/**
 * Whether the commit that added `READY-FOR-DEVICE <id>` to docs/PROGRESS.md
 * is an ancestor of `sha`, in the repository at `cwd`. The adding commit is
 * the oldest whose diff changes how often the marker occurs.
 */
export function readyIsAncestor(id, sha, cwd) {
  const run = (...args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return null
    }
  }
  const ready = (
    run('log', '--format=%H', `-SREADY-FOR-DEVICE ${id}`, '--', 'docs/PROGRESS.md') ?? ''
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1)
  return Boolean(ready) && run('merge-base', '--is-ancestor', ready, sha) !== null
}

function showJson(ref, path) {
  const text = tryGit('show', `${ref}:${path}`)
  return text === null ? null : JSON.parse(text)
}

/**
 * `--base <ref>` compares against that ref (CI passes the pull request's base
 * branch, fetched); with no base only the list itself is checked. With
 * `--opened <iso>` (and `--author <login>`), CI also holds the pull request to
 * a PROGRESS.md entry of its own.
 */
function main(argv) {
  const root = new URL('../../', import.meta.url)
  const base = argv[argv.indexOf('--base') + 1]
  const head = JSON.parse(readFileSync(new URL('docs/features.json', root), 'utf8'))
  const catalogue = catalogueIds(readFileSync(new URL('docs/TESTING.md', root), 'utf8'))

  const errors = validate(head, { catalogue })
  const github = fileURLToPath(new URL('.github/', root))
  errors.push(
    ...forbiddenNames(
      (existsSync(github) ? readdirSync(github, { recursive: true }) : [])
        .map((path) => join('.github', String(path)))
        .filter((path) => statSync(fileURLToPath(new URL(path, root))).isFile())
        .map((path) => ({ path, text: readFileSync(new URL(path, root), 'utf8') }))
    )
  )
  if (argv.includes('--base') && errors.length === 0) {
    const before = showJson(base, 'docs/features.json')
    // A base that cannot be read would make every feature look new.
    if (!before) errors.push(`cannot read docs/features.json at ${base}`)
    const { errors: changes, flipped } = compare(before ?? [], head)
    errors.push(...changes)
    const progress = addedLines(
      tryGit('show', `${base}:docs/PROGRESS.md`) ?? '',
      readFileSync(new URL('docs/PROGRESS.md', root), 'utf8')
    )
    if (argv.includes('--opened'))
      errors.push(
        ...progressEntryErrors(progress, {
          opened: argv[argv.indexOf('--opened') + 1],
          now: new Date().toISOString(),
          author: argv.includes('--author') ? argv[argv.indexOf('--author') + 1] : undefined
        })
      )
    if (flipped.length > 0) {
      const results = 'refs/remotes/origin/device-results'
      if (flipped.some((feature) => feature.verification !== 'ci')) {
        tryGit('fetch', '--no-tags', '--depth=1', 'origin', `+device-results:${results}`)
        // Ancestry needs the history a shallow checkout leaves out.
        if (git('rev-parse', '--is-shallow-repository').trim() === 'true')
          tryGit('fetch', '--no-tags', '--unshallow', 'origin')
      }
      errors.push(
        ...flipErrors(flipped, {
          progress,
          summary: (sha) => showJson(results, `results/${sha}/summary.json`),
          acceptance: (date) => showJson(results, `acceptance/${date}/results.json`),
          readyIsAncestor: (id, sha) => readyIsAncestor(id, sha)
        })
      )
    }
  }

  for (const error of errors) console.error(`features-check: ${error}`)
  if (errors.length > 0) process.exit(1)
  console.log(`features-check: ${head.length} features, all rules hold`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
