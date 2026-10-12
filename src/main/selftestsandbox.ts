import {
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
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

/** How deep below the owner's BIOS folder files are linked into a sandbox. */
const BIOS_DEPTH = 4

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
   * `resolveLinks`. A parameter so the plan stays checkable without a disk.
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
  return { kind: 'run', argv, env: { ...env, ...roots }, unset, folders, files }
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
 * Makes the sandbox's folders, writes the recipe's files and links the
 * owner's BIOS files into `folders.bios`.
 *
 * Links, not copies: a BIOS set can be gigabytes, and the emulator only reads
 * it. A write through a link would reach the owner's file, which is what the
 * owner-state manifest around every run is there to catch. Returns how many
 * BIOS files were linked.
 */
export function prepareSandbox(
  plan: Extract<SandboxPlan, { kind: 'run' }>,
  ownerBios: string | null
): number {
  const { folders } = plan
  for (const dir of [...Object.values(folders), ...Object.values(xdgRoots(folders))]) {
    mkdirSync(dir, { recursive: true })
  }
  for (const file of plan.files) writeWhole(file.path, file.content)
  return ownerBios === null ? 0 : linkTree(ownerBios, folders.bios, BIOS_DEPTH)
}

function linkTree(from: string, to: string, depth: number): number {
  let entries: string[]
  try {
    entries = readdirSync(from)
  } catch {
    return 0
  }
  let linked = 0
  for (const name of entries) {
    const source = join(from, name)
    let kind: 'file' | 'dir' | null = null
    try {
      const info = statSync(source)
      kind = info.isFile() ? 'file' : info.isDirectory() ? 'dir' : null
    } catch {
      continue
    }
    if (kind === 'file') {
      if (linkOnce(source, join(to, name))) linked += 1
    } else if (kind === 'dir' && depth > 1) {
      mkdirSync(join(to, name), { recursive: true })
      linked += linkTree(source, join(to, name), depth - 1)
    }
  }
  return linked
}

/** A second launch of the same emulator finds its links already made. */
function linkOnce(source: string, link: string): boolean {
  try {
    symlinkSync(source, link)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw cause
  }
}

function writeWhole(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const part = `${path}.part`
  writeFileSync(part, content)
  renameSync(part, path)
}
