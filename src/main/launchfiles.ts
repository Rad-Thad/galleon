import { mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { LaunchFile } from '@config/emulators'
import { rootPaths } from './root.ts'
import { t } from './i18n.ts'

/** The folder of RomMix's own an emulator's launch files live in. */
export function launcherDir(emulatorId: string, root = rootPaths().config): string {
  return join(root, 'launch', emulatorId)
}

/**
 * Write a launch's files into `dir`, each whole before the launch reads it.
 *
 * Written through a temporary name and renamed, so an emulator never reads a
 * half-written config from a launch that was interrupted. A name that is not a
 * plain file name is refused rather than written somewhere outside `dir`.
 */
export async function writeLaunchFiles(dir: string, files: readonly LaunchFile[]): Promise<void> {
  if (files.length === 0) return
  await mkdir(dir, { recursive: true })
  for (const file of files) {
    if (file.name === '' || basename(file.name) !== file.name || file.name.startsWith('.')) {
      throw new Error(t('launch.badLaunchFile', { name: file.name }))
    }
    const path = join(dir, file.name)
    const partial = `${path}.partial`
    await writeFile(partial, file.content)
    await rename(partial, path)
  }
}
