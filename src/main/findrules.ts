import { constants } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

/**
 * Where an emulator lives, decided the way ES-DE decides it on armadaOS.
 *
 * The Armada Store installs emulators where ES-DE's `linuxarm` find rules look
 * for them, and seeds `~/ES-DE/custom_systems/` with its own rules and systems
 * on top (docs/research/armada_integration.md, Q6). Reading those same files,
 * rather than keeping a list of our own, is what lets a descriptor find an
 * emulator wherever the store put it today and wherever it puts it next year.
 *
 * The bundled copy is vendored and pinned in `packaging/es-de/linuxarm/`
 * (THIRD_PARTY.md). An entry in a custom file replaces the bundled entry with
 * the same name whole, as it does in ES-DE: a rule is a list of places to look,
 * and merging two such lists would look in places neither file asked for.
 *
 * Parsing is pure and takes the files' text, so it is tested against fixtures;
 * only `loadFindRules` and the resolvers touch the filesystem.
 */

/** An element of an XML document; text is the concatenated character data. */
export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return ENTITIES[ref] ?? whole
    const code =
      ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const TAG = /^<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const CLOSE = /^<\/([A-Za-z_][\w.:-]*)\s*>/

/**
 * Every top-level element of an XML file, in order, or null when it is not
 * well-formed.
 *
 * A forest rather than one root: ES-DE's parser accepts several top-level
 * elements, so a hand-edited custom file with a second `<ruleList>`, or an
 * `<emulator>` pasted after the closing tag, works there and has to work here.
 * Declarations, comments, processing instructions and a doctype are skipped.
 */
export function parseXml(source: string): XmlElement[] | null {
  const roots: XmlElement[] = []
  const stack: XmlElement[] = []
  let at = 0

  const append = (text: string): void => {
    const open = stack.at(-1)
    if (open) open.text += text
    // Character data between top-level elements is only whitespace in a file
    // either party writes; anything else there is not a document.
    else if (text.trim()) at = -1
  }

  while (at >= 0 && at < source.length) {
    const lt = source.indexOf('<', at)
    if (lt < 0) {
      append(decode(source.slice(at)))
      break
    }
    append(decode(source.slice(at, lt)))
    if (at < 0) break
    const rest = source.slice(lt)

    const skip = (terminator: string): void => {
      const end = source.indexOf(terminator, lt)
      at = end < 0 ? -1 : end + terminator.length
    }
    if (rest.startsWith('<!--')) {
      skip('-->')
      continue
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = source.indexOf(']]>', lt)
      if (end < 0 || stack.length === 0) return null
      stack[stack.length - 1].text += source.slice(lt + 9, end)
      at = end + 3
      continue
    }
    if (rest.startsWith('<?')) {
      skip('?>')
      continue
    }
    if (rest.startsWith('<!')) {
      skip('>')
      continue
    }

    const close = CLOSE.exec(rest)
    if (close) {
      if (stack.pop()?.name !== close[1]) return null
      at = lt + close[0].length
      continue
    }

    const tag = TAG.exec(rest)
    if (!tag) return null
    const element: XmlElement = { name: tag[1], attributes: {}, children: [], text: '' }
    for (const [, key, double, single] of tag[2].matchAll(ATTRIBUTE)) {
      element.attributes[key] = decode(double ?? single)
    }
    const parent = stack.at(-1)
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!tag[3]) stack.push(element)
    at = lt + tag[0].length
  }

  return at < 0 || stack.length > 0 ? null : roots
}

/** The kinds of rule a `linuxarm` file uses; ES-DE's Windows and Android kinds never apply. */
export type RuleType = 'systempath' | 'staticpath' | 'corepath'

export interface FindRule {
  type: RuleType
  entries: string[]
}

/** Where a rule set came from, for the pre-flight check and the log. */
export type RuleSource = 'bundled' | 'custom'

/** One `<emulator>` or `<core>` element: a name and where to look for it, in order. */
export interface RuleSet {
  name: string
  rules: FindRule[]
  source: RuleSource
}

/** One `<system>`: the fields a descriptor's launch may want from it. */
export interface SystemEntry {
  name: string
  fullname: string
  path: string
  extensions: string[]
  commands: { label: string; command: string }[]
  platforms: string[]
  source: RuleSource
}

export interface FindRules {
  emulators: Map<string, RuleSet>
  cores: Map<string, RuleSet>
  systems: Map<string, SystemEntry>
}

const RULE_TYPES: readonly string[] = ['systempath', 'staticpath', 'corepath']

/**
 * The elements called `name` in a file's forest: those inside a top-level
 * `container` element and those standing loose at the top level.
 */
function collect(forest: readonly XmlElement[], container: string, name: string): XmlElement[] {
  return forest.flatMap((node) =>
    node.name === container
      ? node.children.filter((child) => child.name === name)
      : node.name === name
        ? [node]
        : []
  )
}

const childText = (element: XmlElement, name: string): string =>
  element.children.find((child) => child.name === name)?.text.trim() ?? ''

function ruleSet(element: XmlElement, source: RuleSource): RuleSet | null {
  const name = element.attributes.name?.trim()
  if (!name) return null
  const rules = element.children
    .filter((child) => child.name === 'rule' && RULE_TYPES.includes(child.attributes.type))
    .map((rule) => ({
      type: rule.attributes.type as RuleType,
      entries: rule.children
        .filter((entry) => entry.name === 'entry')
        .map((entry) => entry.text.trim())
        .filter(Boolean)
    }))
  return { name, rules, source }
}

function systemEntry(element: XmlElement, source: RuleSource): SystemEntry | null {
  const name = childText(element, 'name')
  if (!name) return null
  return {
    name,
    fullname: childText(element, 'fullname'),
    path: childText(element, 'path'),
    extensions: childText(element, 'extension').split(/\s+/).filter(Boolean),
    commands: element.children
      .filter((child) => child.name === 'command')
      .map((child) => ({ label: child.attributes.label ?? '', command: child.text.trim() })),
    // ES-DE allows a comma-separated list, for a system that is several platforms.
    platforms: childText(element, 'platform')
      .split(',')
      .map((platform) => platform.trim())
      .filter(Boolean),
    source
  }
}

/**
 * Replace or add, by name. A replaced entry keeps its place, so the order of
 * the bundled file — which is the order ES-DE lists them in — survives.
 */
function overlay<T extends { name: string }>(into: Map<string, T>, items: readonly T[]): void {
  for (const item of items) into.set(item.name, item)
}

export function emptyFindRules(): FindRules {
  return { emulators: new Map(), cores: new Map(), systems: new Map() }
}

/** Layer one es_find_rules.xml's text onto `rules`; false when it did not parse. */
export function addFindRules(rules: FindRules, text: string, source: RuleSource): boolean {
  const forest = parseXml(text)
  if (!forest) return false
  const sets = (name: string): RuleSet[] =>
    collect(forest, 'ruleList', name)
      .map((element) => ruleSet(element, source))
      .filter((set) => set !== null)
  overlay(rules.emulators, sets('emulator'))
  overlay(rules.cores, sets('core'))
  return true
}

/** Layer one es_systems.xml's text onto `rules`; false when it did not parse. */
export function addSystems(rules: FindRules, text: string, source: RuleSource): boolean {
  const forest = parseXml(text)
  if (!forest) return false
  overlay(
    rules.systems,
    collect(forest, 'systemList', 'system')
      .map((element) => systemEntry(element, source))
      .filter((system) => system !== null)
  )
  return true
}

/** The files `loadFindRules` reads from each folder. */
export const FIND_RULES_FILE = 'es_find_rules.xml'
export const SYSTEMS_FILE = 'es_systems.xml'

/** What `loadFindRules` read, and the files it had to leave out. */
export interface LoadedFindRules {
  rules: FindRules
  /** Files that exist but did not parse; their entries are not applied. */
  unreadable: string[]
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The bundled files with the custom folder's on top.
 *
 * A missing custom file is the ordinary case off armadaOS and says nothing.
 * One that is there but broken is left out whole and reported, the way ES-DE
 * skips it, so a typo in a hand edit costs that file's overrides and not every
 * emulator.
 */
export async function loadFindRules(
  bundledDir: string,
  customDir: string
): Promise<LoadedFindRules> {
  const rules = emptyFindRules()
  const unreadable: string[] = []
  for (const [dir, source] of [
    [bundledDir, 'bundled'],
    [customDir, 'custom']
  ] as const) {
    for (const [file, add] of [
      [FIND_RULES_FILE, addFindRules],
      [SYSTEMS_FILE, addSystems]
    ] as const) {
      const path = join(dir, file)
      const text = await readText(path)
      if (text !== null && !add(rules, text, source)) unreadable.push(path)
    }
  }
  return { rules, unreadable }
}

/** Which rule found an emulator, and where: what the pre-flight check names. */
export interface Resolution {
  emulator: string
  source: RuleSource
  type: RuleType
  /** The entry as the file wrote it, `~` and `*` and all. */
  entry: string
  path: string
}

export interface ResolveContext {
  home: string
  /** The PATH a `systempath` rule searches, as the environment holds it. */
  pathVariable: string
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  if (!(await isFile(path))) return false
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** `~` at the start of an entry is the home folder, as a shell would read it. */
export function expandHome(entry: string, home: string): string {
  return entry === '~' ? home : entry.startsWith('~/') ? join(home, entry.slice(2)) : entry
}

function globSegment(segment: string): RegExp {
  // Case-sensitive, as ES-DE matches on Linux: the rules name files exactly
  // as their projects publish them.
  return new RegExp(`^${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`)
}

/**
 * Every existing path an absolute pattern names, where `*` may stand in any
 * component, sorted within each folder. A rule takes the last that exists,
 * as `findMatchingFile` does: of two versions side by side, the later one.
 */
export async function expandGlob(pattern: string): Promise<string[]> {
  if (!pattern.startsWith('/')) return []
  let paths = ['/']
  for (const segment of pattern.split('/').filter(Boolean)) {
    if (!segment.includes('*')) {
      paths = paths.map((path) => join(path, segment))
      continue
    }
    const matcher = globSegment(segment)
    const next: string[] = []
    for (const path of paths) {
      let names: string[]
      try {
        names = await readdir(path)
      } catch {
        continue
      }
      const matching = names.filter((candidate) => matcher.test(candidate))
      for (const name of matching.sort((a, b) => a.localeCompare(b))) next.push(join(path, name))
    }
    paths = next
  }
  return paths
}

async function findEntry(
  type: RuleType,
  entry: string,
  ctx: ResolveContext
): Promise<string | null> {
  if (type === 'systempath') {
    // A bare program name, looked up as `which` would: a path in the entry is
    // a staticpath rule's job.
    if (entry.includes('/')) return null
    for (const dir of ctx.pathVariable.split(delimiter).filter(Boolean)) {
      const candidate = join(dir, entry)
      if (await isExecutableFile(candidate)) return candidate
    }
    return null
  }
  const matches = await expandGlob(expandHome(entry, ctx.home))
  const exists = type === 'corepath' ? isDirectory : isFile
  for (const match of matches.toReversed()) {
    if (await exists(match)) return match
  }
  return null
}

/**
 * The first place a rule set's rules find something, in the order the file
 * lists rules and entries, or null when nothing it names exists.
 */
export async function resolveRuleSet(
  set: RuleSet,
  ctx: ResolveContext
): Promise<Resolution | null> {
  for (const rule of set.rules) {
    for (const entry of rule.entries) {
      const path = await findEntry(rule.type, entry, ctx)
      if (path) return { emulator: set.name, source: set.source, type: rule.type, entry, path }
    }
  }
  return null
}

/** `resolveRuleSet` for the emulator rules named `name`; null when there are none. */
export async function findEmulator(
  rules: FindRules,
  name: string,
  ctx: ResolveContext
): Promise<Resolution | null> {
  const set = rules.emulators.get(name)
  return set ? resolveRuleSet(set, ctx) : null
}
