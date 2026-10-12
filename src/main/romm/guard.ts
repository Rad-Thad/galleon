import { t } from '../i18n.ts'
import { log } from '../log.ts'
import { ReadOnlyError } from './errors.ts'

/**
 * What keeps the device self-test from changing anything on the owner's RomM.
 *
 * The self-test signs in with the owner's own account, so the server cannot
 * tell its requests from the owner's: whatever it would write — a save, a
 * device, a play session, a favourite, a rotated token — lands in the owner's
 * library for good. The guard therefore sits in the one place every request
 * passes through (`RommClient.request`) and lets only reads out, so a call site
 * added later is covered without anyone remembering to.
 *
 * A refusal is counted rather than only logged: the self-test reports the
 * count as `safety.serverWritesAttempted`, and any number above zero is a code
 * path that would have written, found before it can reach a server that is
 * not a test one.
 */
export class ReadOnlyGuard {
  serverWritesAttempted = 0

  /** The path to send, or a `ReadOnlyError` for a request that could write. */
  admit(method: string, path: string): string {
    if (!READ_METHODS.has(method.toUpperCase())) {
      this.serverWritesAttempted += 1
      log.warn('romm', 'read-only: refused a request that could write', { method, path })
      throw new ReadOnlyError(t('error.readOnly', { method }))
    }
    return withoutDeviceId(path)
  }
}

const READ_METHODS = new Set(['GET', 'HEAD'])

/**
 * The path without a `device_id` in its query.
 *
 * RomM records what a named device has fetched, so even a read that names one
 * changes what the server tells that device's next sync. Removed from every
 * path rather than only save and state ones, since no read Galleon makes needs
 * it to get an answer.
 */
export function withoutDeviceId(path: string): string {
  const mark = path.indexOf('?')
  if (mark === -1) return path
  const query = new URLSearchParams(path.slice(mark + 1))
  if (!query.has('device_id')) return path
  query.delete('device_id')
  const rest = query.toString()
  return rest ? `${path.slice(0, mark)}?${rest}` : path.slice(0, mark)
}
