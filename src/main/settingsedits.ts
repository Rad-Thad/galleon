import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { editSetting, type SettingsEdit, type SettingsFolder } from '@config/emulators'
import { discardStaged, replaceSave, stageBeside } from './savewriter.ts'
import { rootPaths } from './root.ts'
import { t } from './i18n.ts'
import { log } from './log.ts'

/** Where the settings files an edit replaced are kept, per emulator. */
export function settingsBackups(emulatorId: string, root = rootPaths().saves): string {
  return join(root, 'settings', emulatorId)
}

/** Whether `file` would land outside the folder it is relative to. */
function escapes(file: string): boolean {
  return isAbsolute(file) || normalize(file).split(sep).includes('..')
}

/**
 * Make sure the folder an edit's value names is a folder, making it when
 * nothing is there. False when something else holds the name: that is the
 * user's, and is left as it is.
 */
async function ensureFolder(configDir: string, folder: SettingsFolder): Promise<boolean> {
  const path = join(configDir, folder.path)
  const found = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === 'ENOENT') return null
    throw cause
  })
  if (found) return found.isDirectory()
  await mkdir(path, { recursive: true })
  for (const name of folder.files) await writeFile(join(path, name), '', { flag: 'wx' })
  log.info('launch', 'made the folder a setting names', { path })
  return true
}

/**
 * Set each key in the emulator's own settings file under `configDir`.
 *
 * The file is put back through `replaceSave`, so the one it replaces is
 * copied aside first and nothing is written when that copy fails, and the new
 * one lands whole. A file that is not there stays missing: starting one fresh
 * is what brings back the first-run dialogs (ADR 0005), and an emulator that
 * has never run has nothing to keep. A file already set is not touched.
 * An edit with a `folder` sets its key only once that folder is there.
 */
export async function applySettingsEdits(
  configDir: string | null,
  edits: readonly SettingsEdit[],
  backups: string
): Promise<void> {
  for (const edit of edits) {
    for (const name of [edit.file, ...(edit.folder ? [edit.folder.path] : [])]) {
      if (escapes(name)) throw new Error(t('launch.badSettingsFile', { name }))
    }
    if (!configDir) {
      log.warn('launch', 'no config folder to set a setting in', { file: edit.file, key: edit.key })
      continue
    }
    const path = join(configDir, edit.file)
    const text = await readFile(path, 'utf8').catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return null
      throw cause
    })
    if (text === null) {
      log.info('launch', 'settings file not there yet, left alone', { path, key: edit.key })
      continue
    }
    // The folder first, so the key never names a folder that is not there.
    if (edit.folder && !(await ensureFolder(configDir, edit.folder))) {
      log.warn('launch', 'something other than a folder holds the name, setting left alone', {
        path: join(configDir, edit.folder.path),
        key: edit.key
      })
      continue
    }
    const next = editSetting(text, edit)
    if (next === null) continue
    const staged = await stageBeside(path)
    try {
      await writeFile(staged, next)
      await replaceSave(path, staged, backups)
    } catch (cause) {
      await discardStaged(staged)
      throw cause
    }
    log.info('launch', "set one setting in the emulator's own file", {
      path,
      section: edit.section,
      key: edit.key,
      value: edit.value
    })
  }
}
