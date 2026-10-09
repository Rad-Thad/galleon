#!/usr/bin/env node
//
// The licence and dependency guard (CLAUDE.md, rails 4 and 8). Galleon ships
// as an MIT AppImage, so three things must never reach it unnoticed:
//
// - a runtime dependency added since the fork without a docs/DEPENDENCIES.md
//   row giving its exact version, licence and reason;
// - anything in the production dependency tree under a licence outside the
//   permissive set, the GPL family above all;
// - text copied from the GPL projects read as specification, recognised by
//   identifiers that only a copy would carry.
//
// Reads the repository and `npm ls`; changes nothing. Exits 1 with one line per
// problem.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * RomMix's runtime dependencies at the fork point. DEPENDENCIES.md does not
 * repeat them; everything else must be there.
 */
export const FORK_POINT = ['lucide-react', 'qrcode-generator', 'yauzl']

/** Licences a runtime dependency may carry (rail 8), as SPDX ids. */
const PERMISSIVE = new Set([
  'MIT',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'MPL-2.0'
])

/**
 * Whether an SPDX expression lets Galleon ship the package: an `OR` needs one
 * permissive side, an `AND` needs both. Anything unreadable is refused, since
 * a licence nobody can name is not one the rails allow.
 */
export function licenceAllowed(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') return false
  const text = expression.trim().replace(/^\((.*)\)$/, '$1')
  if (/\s+OR\s+/i.test(text)) return text.split(/\s+OR\s+/i).some(licenceAllowed)
  if (/\s+AND\s+/i.test(text)) return text.split(/\s+AND\s+/i).every(licenceAllowed)
  return PERMISSIVE.has(text)
}

/** A package.json `license`, or the older `licenses` array, as one expression. */
export function licenceOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license
  if (manifest.license?.type) return manifest.license.type
  if (Array.isArray(manifest.licenses))
    return manifest.licenses.map((entry) => entry.type ?? entry).join(' OR ')
  return null
}

/** The rows of the `## Runtime` table in DEPENDENCIES.md, by name. */
export function runtimeRows(markdown) {
  const section = /^## Runtime\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown)
  const rows = new Map()
  if (!section) return rows
  for (const line of section[1].split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length < 4 || cells[0] === 'Name' || /^-+$/.test(cells[0])) continue
    const [name, version, licence, why] = cells.map((cell) => cell.replace(/`/g, ''))
    rows.set(name, { version, licence, why })
  }
  return rows
}

/** Problems with the direct runtime dependencies against DEPENDENCIES.md. */
export function checkDirect(dependencies, rows) {
  const problems = []
  for (const [name, spec] of Object.entries(dependencies ?? {})) {
    if (FORK_POINT.includes(name)) continue
    const row = rows.get(name)
    if (!row) {
      problems.push(
        `${name}: a runtime dependency with no row under "## Runtime" in docs/DEPENDENCIES.md`
      )
      continue
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(spec))
      problems.push(`${name}: package.json asks for "${spec}", not an exact version`)
    else if (row.version !== spec)
      problems.push(`${name}: DEPENDENCIES.md says ${row.version}, package.json ${spec}`)
    if (!licenceAllowed(row.licence))
      problems.push(
        `${name}: DEPENDENCIES.md gives the licence "${row.licence}", which may not ship`
      )
    if (!row.why) problems.push(`${name}: DEPENDENCIES.md gives no reason for it`)
  }
  return problems
}

/** Problems with the production tree: each package's name, version and licence. */
export function checkTree(packages) {
  return packages
    .filter((pkg) => !licenceAllowed(pkg.licence))
    .map(
      (pkg) =>
        `${pkg.name}@${pkg.version}: licence "${pkg.licence ?? 'none'}" may not ship in the AppImage`
    )
}

/**
 * Strings that only text copied from a GPL project would carry: Argosy's
 * Android package, and the GNU licence headers any of them puts on a source
 * file. Assembled from parts so that this file does not match itself.
 */
export const COPIED_MARKERS = [
  ['com', 'nendo', 'argosy'].join('.'),
  ['GNU', 'General Public License'].join(' '),
  ['GNU', 'Lesser General Public License'].join(' '),
  ['GNU', 'Affero General Public License'].join(' ')
]

/**
 * Files that are code or data shipped or run, where a copy would be. Prose
 * under docs/ names these projects on purpose, and licence texts are not code.
 */
export function scanned(path) {
  if (/^(docs\/|node_modules\/|\.git\/)/.test(path)) return false
  if (/(^|\/)(LICENSE|COPYING|OFL[^/]*)(\.\w+)?$/i.test(path)) return false
  return /\.(m?[jt]sx?|mts|py|sh|css|html|json|ya?ml|gd|kt|java|c|h|cpp|rs|go|glsl|slang)$/i.test(
    path
  )
}

/** `path: marker` for every scanned file carrying a marker. */
export function checkCopied(files) {
  const problems = []
  for (const { path, text } of files) {
    if (!scanned(path)) continue
    for (const marker of COPIED_MARKERS)
      if (text.includes(marker))
        problems.push(`${path}: carries "${marker}", text from a GPL project (CLAUDE.md, rail 4)`)
  }
  return problems
}

function productionTree(root) {
  const out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
    cwd: root,
    encoding: 'utf8'
  })
  return out
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((dir) => {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      return { name: manifest.name, version: manifest.version, licence: licenceOf(manifest) }
    })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = new URL('../..', import.meta.url).pathname
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const rows = runtimeRows(readFileSync(join(root, 'docs/DEPENDENCIES.md'), 'utf8'))
  const tree = productionTree(root)
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(scanned)
    .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }))
  const problems = [
    ...checkDirect(manifest.dependencies, rows),
    ...checkTree(tree),
    ...checkCopied(files)
  ]
  for (const pkg of tree) console.log(`${pkg.name}@${pkg.version} ${pkg.licence}`)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`licence-guard: ${problem}`)
    process.exit(1)
  }
  console.log(
    `licence-guard: ${tree.length} production packages, ${files.length} files scanned, all permitted`
  )
}
