import type { SettingsEdit } from './types.ts'

/** `[Section]`, the name between the brackets. */
const HEADER = /^\s*\[([^\]]*)\]\s*$/

/**
 * The settings file's text with one key set, or null when nothing changes.
 *
 * Every other line comes back as it was, comments, blank lines and line ends
 * included, so the file differs from the emulator's own only in that value.
 * Sections and keys match without regard to case, as the INI readers of
 * Dolphin (`IniFile`) and PCSX2 (`SettingsInterface`) do; Flycast's reader
 * keeps case, but it only ever writes its own spelling.
 * Only the first matching key of the first matching section is read, the one
 * those readers take.
 */
export function editSetting(text: string, edit: SettingsEdit): string | null {
  const lines = text.split('\n')
  const crlf = text.includes('\r\n')
  const wanted = edit.section.toLowerCase()
  const key = edit.key.toLowerCase()
  let inSection = false
  let sectionFound = false
  /** The line after the section's last setting, where a missing key goes. */
  let insertAt = -1

  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i])
    if (header) {
      if (inSection) break
      inSection = header[1].trim().toLowerCase() === wanted
      if (inSection) {
        sectionFound = true
        insertAt = i + 1
      }
      continue
    }
    if (!inSection) continue
    const line = lines[i]
    if (line.trim() !== '') insertAt = i + 1
    const eq = line.indexOf('=')
    if (eq < 0 || line.slice(0, eq).trim().toLowerCase() !== key) continue
    const end = line.endsWith('\r') ? '\r' : ''
    const body = line.slice(eq + 1, line.length - end.length)
    if (body.trim() === edit.value) return null
    // An empty value has no spacing of its own to keep; `Key = ` is the
    // emulators' own shape.
    const lead = body.trim() === '' ? ' ' : body.slice(0, body.length - body.trimStart().length)
    lines[i] = `${line.slice(0, eq + 1)}${lead}${edit.value}${end}`
    return lines.join('\n')
  }

  if (edit.whenAbsent === 'leave') return null
  const eol = crlf ? '\r' : ''
  const setting = `${edit.key} = ${edit.value}${eol}`
  if (sectionFound) {
    lines.splice(insertAt, 0, setting)
    return lines.join('\n')
  }
  // A last line without its line end is ended first, so the new section does
  // not run onto it.
  const ended = text === '' || text.endsWith('\n') ? text : `${text}${crlf ? '\r\n' : '\n'}`
  const nl = crlf ? '\r\n' : '\n'
  return `${ended}[${edit.section}]${nl}${edit.key} = ${edit.value}${nl}`
}
