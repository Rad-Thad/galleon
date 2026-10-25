import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  EmulatorDescriptor,
  ResolvedInstall,
  SandboxContext,
  SandboxFolders
} from '@config/emulators'
import { childEnvironment } from './childenv.ts'
import { execPrefix } from './host.ts'

/**
 * The emulator sandbox the self-test starts every emulator in.
 *
 * On the Nova the emulators are the owner's, with the owner's settings, saves
 * and states. A launch check that ran one of them as installed would write
 * into all three, so every start goes through `planSandbox`: the XDG roots
 * and the descriptor's own recipe move everything the emulator writes below
 * the test home, and an emulator with no recipe is never started.
 */

/** The reason a launch check gives when it would not start an emulator. */
export const CANNOT_SANDBOX = 'cannot-sandbox'

/**
 * The reason a launch check gives for an emulator that needs a BIOS dump the
 * owner does not have; see `SandboxRecipe.needsBios`.
 */
export const MISSING_BIOS = 'missing-bios'

/** How deep below the owner's BIOS folder files are cloned into a sandbox. */
const BIOS_DEPTH = 4

/**
 * How many bytes of BIOS one sandbox may copy outright where the filesystem
 * cannot clone them, so a large BIOS set on another disk cannot fill the
 * test home.
 */
export const BIOS_COPY_BUDGET = 512 * 1024 * 1024

/** Where one emulator's sandbox lives, below the test home. */
export function sandboxFolders(home: string, emulator: string): SandboxFolders {
  const root = join(home, 'sandbox', emulator)
  return {
    root,
    config: join(root, 'config'),
    data: join(root, 'data'),
    saves: join(root, 'saves'),
    states: join(root, 'states'),
    bios: join(root, 'bios')
  }
}

export interface SandboxRequest {
  descriptor: EmulatorDescriptor
  install: ResolvedInstall
  system: string
  romPath: string
  variant?: string
  /** The test home, `GALLEON_HOME`. */
  home: string
  /** The owner's install, which a recipe may read from. */
  owner: SandboxContext['owner']
  /**
   * A path with every link followed, or null when it cannot be read; see
   * `resolveLinks`. Also how the recipe's `needs` are found. A parameter so the plan stays checkable without a disk.
   */
  realPath: (path: string) => string | null
}

/** `realPath` for a real start. */
export function resolveLinks(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

export type SandboxPlan =
  | {
      kind: 'run'
      argv: string[]
      /** Merged over the child's environment; see `sandboxEnvironment`. */
      env: Record<string, string>
      /** Removed from the child's environment before `env` is merged. */
      unset: string[]
      /** See `SandboxRecipe.strays`. */
      strays: string[]
      /**
       * The folder the emulator starts in: the sandbox's root. An emulator can
       * read and write relative to it, and some take a `user` folder there as
       * their whole portable layout, so it is never one of the owner's.
       */
      cwd: string
      /** Where the copies of the owner's BIOS files go; see `SandboxRecipe.bios`. */
      bios: string
      /** See `SandboxRecipe.needsBios`. */
      needsBios: boolean
      folders: SandboxFolders
      files: { path: string; content: string }[]
    }
  | { kind: 'skip'; reason: typeof CANNOT_SANDBOX; detail: string }

function skip(detail: string): SandboxPlan {
  return { kind: 'skip', reason: CANNOT_SANDBOX, detail }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The XDG roots, set last so no recipe or descriptor can point one back out of
 * the sandbox.
 */
function xdgRoots(folders: SandboxFolders): Record<string, string> {
  return {
    XDG_CONFIG_HOME: folders.config,
    XDG_DATA_HOME: folders.data,
    XDG_STATE_HOME: join(folders.root, 'state'),
    XDG_CACHE_HOME: join(folders.root, 'cache')
  }
}

/**
 * How to start this game inside the emulator's sandbox, or why not.
 *
 * Pure: nothing is written until `prepareSandbox`. A flatpak runs in a
 * filesystem view of its own, and a `scripts` install is somebody else's
 * launcher that may reset any variable it is given, so neither is started on
 * the strength of the XDG roots alone.
 */
export function planSandbox(request: SandboxRequest): SandboxPlan {
  const { descriptor, install, system, romPath, variant, home, owner } = request
  if (install.kind === 'flatpak' || install.kind === 'scripts')
    return skip(`${install.kind}-install`)
  if (descriptor.sandbox === undefined) return skip('no-recipe')
  const target = request.realPath(install.ref)
  if (target === null) return skip('install-unreadable')

  const folders = sandboxFolders(home, descriptor.id)
  const recipe = descriptor.sandbox({
    system,
    installKind: install.kind,
    installRef: install.ref,
    installTarget: target,
    folders,
    owner
  })
  if (recipe === null) return skip('no-recipe')

  const files = recipe.files.map((file) => ({
    path: resolve(folders.root, file.path),
    content: file.content
  }))
  if (files.some((file) => !inside(folders.root, file.path))) return skip('file-outside-sandbox')
  const bios = recipe.bios === null ? folders.bios : resolve(folders.root, recipe.bios)
  if (!inside(folders.root, bios)) return skip('bios-outside-sandbox')
  if (recipe.needs.some((path) => request.realPath(path) === null))
    return skip('needed-file-missing')

  const argv = descriptor.launch({
    exec: [...execPrefix(install), ...recipe.args],
    installRef: install.ref,
    system,
    romPath,
    variant
  })
  if (argv === null) return skip('unsupported-system')

  const roots = xdgRoots(folders)
  const unset = recipe.unset.filter((name) => !(name in roots))
  const env: Record<string, string> = { ...descriptor.env, ...recipe.env }
  for (const name of unset) delete env[name]
  const strays = recipe.strays.filter((path) => isAbsolute(path))
  return {
    kind: 'run',
    argv,
    env: { ...env, ...roots },
    unset,
    strays,
    cwd: folders.root,
    bios,
    needsBios: recipe.needsBios,
    folders,
    files
  }
}

/** The environment a planned start gets, from the one Galleon was started with. */
export function sandboxEnvironment(
  plan: Extract<SandboxPlan, { kind: 'run' }>,
  parentEnv: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const inherited = childEnvironment(parentEnv)
  for (const name of plan.unset) delete inherited[name]
  return { ...inherited, ...plan.env }
}

/**
 * The plan's stray folders that do not exist yet, read just before the start.
 * Only these are the run's to clear: one that was already there is somebody
 * else's.
 */
export function straysToClear(
  plan: Extract<SandboxPlan, { kind: 'run' }>,
  isThere: (path: string) => boolean = existsSync
): string[] {
  return plan.strays.filter((path) => !isThere(path))
}

/**
 * Removes each folder from `straysToClear` after the emulator has exited, and
 * answers the ones removed. Only an empty folder is removed, so nothing in it
 * is ever deleted; one left behind is for the owner-state manifest to report.
 */
export function clearStrays(paths: readonly string[]): string[] {
  const removed: string[] = []
  for (const path of paths) {
    try {
      rmdirSync(path)
      removed.push(path)
    } catch {
      // Not empty, not there, or not a folder: left as it is.
    }
  }
  return removed
}

/**
 * Clones `source` to `target` sharing its blocks, or throws when the
 * filesystem cannot (another disk, or no reflinks); throws `EEXIST` when
 * `target` exists. A clone that fails leaves no `target` behind.
 */
export type CloneFile = (source: string, target: string) => void

/** `CloneFile` for a real start. */
export function cloneFile(source: string, target: string): void {
  copyFileSync(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE)
}

export type PreparedSandbox =
  | { kind: 'ready'; biosFiles: number }
  | { kind: 'skip'; reason: typeof CANNOT_SANDBOX | typeof MISSING_BIOS; detail: string }

/**
 * Makes the sandbox's folders, writes the recipe's files and gives the
 * sandbox its own copy of each of the owner's BIOS files in the plan's `bios`.
 *
 * Never a symlink: emulators keep NVRAM and flash beside their BIOS, and a
 * write through a link would land in the owner's file. A clone shares the
 * owner's blocks until something writes, so a large BIOS set costs nothing on
 * the same filesystem; elsewhere each file is copied, within
 * `BIOS_COPY_BUDGET`. Past the budget the launch is skipped as
 * `cannot-sandbox` rather than started with part of the owner's BIOS.
 * `biosFiles` counts the files this call added; a second start of the same
 * emulator keeps the copies it has, written to or not. An emulator that needs
 * a BIOS is skipped as `missing-bios` when its BIOS folder is left without a
 * file, so it is never started only to stop at its own complaint.
 */
export function prepareSandbox(
  plan: Extract<SandboxPlan, { kind: 'run' }>,
  ownerBios: string | null,
  clone: CloneFile = cloneFile,
  copyBudget: number = BIOS_COPY_BUDGET
): PreparedSandbox {
  const { folders } = plan
  for (const dir of [...Object.values(folders), ...Object.values(xdgRoots(folders)), plan.bios]) {
    mkdirSync(dir, { recursive: true })
  }
  for (const file of plan.files) writeWhole(file.path, file.content)
  const tally = { files: 0, copied: 0, budget: copyBudget, clone }
  if (ownerBios !== null && !copyTree(ownerBios, plan.bios, BIOS_DEPTH, tally)) {
    return { kind: 'skip', reason: CANNOT_SANDBOX, detail: 'bios-too-large' }
  }
  if (plan.needsBios && !holdsFile(plan.bios, BIOS_DEPTH)) {
    return { kind: 'skip', reason: MISSING_BIOS, detail: 'no-bios-files' }
  }
  return { kind: 'ready', biosFiles: tally.files }
}

/** Whether `dir` holds a file of its own within `depth` levels, links not counted. */
function holdsFile(dir: string, depth: number): boolean {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  return entries.some((name) => {
    try {
      const info = lstatSync(join(dir, name))
      if (info.isFile()) return true
      return info.isDirectory() && depth > 1 && holdsFile(join(dir, name), depth - 1)
    } catch {
      return false
    }
  })
}

interface Tally {
  files: number
  copied: number
  readonly budget: number
  readonly clone: CloneFile
}

/** False once a copy would go past the budget. */
function copyTree(from: string, to: string, depth: number, tally: Tally): boolean {
  let entries: string[]
  try {
    entries = readdirSync(from)
  } catch {
    return true
  }
  for (const name of entries) {
    const source = join(from, name)
    let size = 0
    let kind: 'file' | 'dir' | null = null
    try {
      const info = statSync(source)
      kind = info.isFile() ? 'file' : info.isDirectory() ? 'dir' : null
      size = info.size
    } catch {
      continue
    }
    if (kind === 'file') {
      if (!copyOnce(source, join(to, name), size, tally)) return false
    } else if (kind === 'dir' && depth > 1) {
      mkdirSync(join(to, name), { recursive: true })
      if (!copyTree(source, join(to, name), depth - 1, tally)) return false
    }
  }
  return true
}

function copyOnce(source: string, target: string, size: number, tally: Tally): boolean {
  if (keptFrom(target)) return true
  try {
    tally.clone(source, target)
    tally.files += 1
    return true
  } catch (cause) {
    if (exists(cause)) return true
  }
  if (tally.copied + size > tally.budget) return false
  try {
    copyFileSync(source, target, constants.COPYFILE_EXCL)
  } catch (cause) {
    if (exists(cause)) return true
    throw cause
  }
  tally.copied += size
  tally.files += 1
  return true
}

/**
 * Whether the sandbox already holds its own `target`. A link is never kept: a
 * sandbox laid out by a build that linked BIOS files still holds the links.
 */
function keptFrom(target: string): boolean {
  let link: boolean
  try {
    link = lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
  if (link) unlinkSync(target)
  return !link
}

function exists(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'EEXIST'
}

function writeWhole(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const part = `${path}.part`
  writeFileSync(part, content)
  renameSync(part, path)
}
