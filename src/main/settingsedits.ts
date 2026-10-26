import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { editSetting, type SettingsEdit } from '@config/emulators'
import { discardStaged, replaceSave, stageBeside } from './savewriter.ts'
import { rootPaths } from './root.ts'
import { t } from './i18n.ts'
import { log } from './log.ts'

/** Where the settings files an edit replaced are kept, per emulator. */
export function settingsBackups(emulatorId: string, root = rootPaths().saves): string {
  return join(root, 'settings', emulatorId)
}

/**
 * Set each key in the emulator's own settings file under `configDir`.
 *
 * The file is put back through `replaceSave`, so the one it replaces is
 * copied aside first and nothing is written when that copy fails, and the new
 * one lands whole. A file that is not there stays missing: starting one fresh
 * is what brings back the first-run dialogs (ADR 0005), and an emulator that
 * has never run has nothing to keep. A file already set is not touched.
 */
export async function applySettingsEdits(
  configDir: string | null,
  edits: readonly SettingsEdit[],
  backups: string
): Promise<void> {
  for (const edit of edits) {
    if (isAbsolute(edit.file) || normalize(edit.file).split(sep).includes('..')) {
      throw new Error(t('launch.badSettingsFile', { name: edit.file }))
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
