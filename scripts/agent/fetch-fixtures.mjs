#!/usr/bin/env node
/**
 * Fetch the homebrew ROMs listed in test/fixtures/roms/manifest.json into the
 * test library (test/romm/library/ unless --out says otherwise).
 *
 *   node scripts/agent/fetch-fixtures.mjs [--out <dir>] [--manifest <file>]
 *
 * The synthetic library (test/romm/make-library.mjs) covers the shapes; these
 * are the few real, legally redistributable programs for paths that need a
 * real hash or a ROM an emulator will actually boot. None of them is in the
 * repository: the manifest pins each by URL and SHA-256 and names its licence
 * and author, and a file whose bytes differ from the pinned hash is refused
 * and never written. Run make-library first, since it clears its tree.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const DEFAULT_MANIFEST = join(root, 'test/fixtures/roms/manifest.json')
export const DEFAULT_OUT = join(root, 'test/romm/library')

const SHA256 = /^[0-9a-f]{64}$/

/** Payloads stay small enough to download on the device (docs/PLAN.md, section 5). */
export const MAX_BYTES = 16 * 1024 * 1024

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The manifest's entries, or an error naming every entry that lacks what a
 * redistributed file needs: where it came from, its exact bytes, its licence
 * and who to credit. Paths stay inside the library.
 */
export function validateManifest(manifest) {
  const files = manifest?.files
  if (!Array.isArray(files) || files.length === 0) throw new Error('manifest has no files')
  const problems = []
  const seen = new Set()
  for (const [i, f] of files.entries()) {
    const at = `files[${i}]${typeof f?.path === 'string' ? ` (${f.path})` : ''}`
    if (
      typeof f?.path !== 'string' ||
      f.path === '' ||
      isAbsolute(f.path) ||
      f.path.split(/[\\/]/).some((part) => part === '..' || part === '')
    ) {
      problems.push(`${at}: path must be relative, inside the library`)
    } else if (!f.path.startsWith('roms/')) {
      problems.push(`${at}: path must be under roms/`)
    } else if (seen.has(f.path)) {
      problems.push(`${at}: path listed twice`)
    } else {
      seen.add(f.path)
    }
    let url
    try {
      url = new URL(f?.url)
    } catch {
      url = undefined
    }
    if (url?.protocol !== 'https:') problems.push(`${at}: url must be https`)
    if (typeof f?.sha256 !== 'string' || !SHA256.test(f.sha256)) {
      problems.push(`${at}: sha256 must be 64 lowercase hex digits`)
    }
    if (!Number.isInteger(f?.bytes) || f.bytes <= 0 || f.bytes > MAX_BYTES) {
      problems.push(`${at}: bytes must be a positive integer no larger than MAX_BYTES`)
    }
    for (const key of ['licence', 'attribution']) {
      if (typeof f?.[key] !== 'string' || f[key].trim() === '') {
        problems.push(`${at}: ${key} is required`)
      }
    }
  }
  if (problems.length > 0) throw new Error(`invalid manifest:\n  ${problems.join('\n  ')}`)
  return files
}

export function loadManifest(path = DEFAULT_MANIFEST) {
  return validateManifest(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * Put every entry under `out`. A file already there with the pinned hash is
 * kept; anything else is downloaded, checked against the pin and only then
 * written, through a temporary name so a refused or interrupted download
 * leaves no file behind under the real name. Stops at the first refusal.
 */
export async function fetchFixtures(files, out = DEFAULT_OUT, { fetch: get = fetch } = {}) {
  const results = []
  for (const f of files) {
    const target = join(out, f.path)
    if (existsSync(target) && sha256(readFileSync(target)) === f.sha256) {
      results.push({ path: f.path, status: 'kept' })
      continue
    }
    const response = await get(f.url)
    if (!response.ok) throw new Error(`${f.path}: ${f.url} answered ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const actual = sha256(bytes)
    if (actual !== f.sha256 || bytes.length !== f.bytes) {
      throw new Error(
        `${f.path}: refused, ${f.url} gave sha256 ${actual} (${bytes.length} bytes); the manifest pins ${f.sha256} (${f.bytes} bytes)`
      )
    }
    mkdirSync(dirname(target), { recursive: true })
    const partial = `${target}.partial`
    writeFileSync(partial, bytes)
    renameSync(partial, target)
    results.push({ path: f.path, status: 'fetched' })
  }
  return results
}

/** `--out <dir>` and `--manifest <file>`, each optional. */
export function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, manifest: DEFAULT_MANIFEST }
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1]
    if (argv[i] === '--out' && value !== undefined) options.out = resolve(value)
    else if (argv[i] === '--manifest' && value !== undefined) options.manifest = resolve(value)
    else {
      throw new Error(
        `usage: fetch-fixtures.mjs [--out <dir>] [--manifest <file>], not: ${argv.join(' ')}`
      )
    }
  }
  return options
}

if (import.meta.main) {
  try {
    const { out, manifest } = parseArgs(process.argv.slice(2))
    for (const { path, status } of await fetchFixtures(loadManifest(manifest), out)) {
      console.log(`${status} ${path}`)
    }
  } catch (error) {
    console.error(`fetch-fixtures: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
