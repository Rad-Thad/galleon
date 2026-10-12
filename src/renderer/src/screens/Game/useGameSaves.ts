import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveProgress } from '@shared/api'
import { conflictsIn } from '@shared/saveassets'
import type {
  ConflictChoice,
  PendingSave,
  SaveAsset,
  SaveDeleteScope,
  SavePushPreview
} from '@shared/types'
import { useApp, useI18n } from '../../state'
import type { ConflictAnswer } from './ConflictDialog'
import { deleteScopeLabel } from './tabs'

/** The conflicts the dialog is working through, and the name of this device's column. */
export interface OpenConflicts {
  list: PendingSave[]
  deviceName: string
  /**
   * How many have been answered since the dialog opened, so its count moves on
   * with each answer rather than staying at the first of however many are left.
   */
  answered: number
}

/** How this game is named and pictured in a toast. */
type Subject = () => { title: string; coverPath: string | null }

/**
 * This game's saves, and the four things the game screen does to them: pull,
 * push, push a confirmed selection, delete one end.
 *
 * A hook rather than more of the screen because these are one subject with one
 * invariant: every one of them changes what is on the two sides, so every one
 * of them has to reload the list afterwards — and a screen that also downloads,
 * launches and uninstalls is where that rule goes missing from.
 *
 * `busy` is the hook's own: the screen ORs it into the flag that greys the
 * buttons out, so a push in progress disables Play exactly as it did when both
 * were one flag.
 */
export function useGameSaves(
  romId: number,
  subject: Subject
): {
  assets: SaveAsset[] | null
  /** True while this game has saves RomM has not been given. See `drain`. */
  waiting: boolean
  reload: () => Promise<void>
  busy: boolean
  /** The transfer running now, for the panel that reports it. Null when idle. */
  progress: SaveProgress | null
  syncSaves: (direction: 'pull' | 'push') => Promise<void>
  /**
   * `alwaysAsk` for the files a session left behind: those are the ones the
   * automatic pass would not send unasked, so sending them silently on a press
   * would answer the question the press was about.
   */
  beginPush: (alwaysAsk?: boolean) => Promise<void>
  sendPush: (preview: SavePushPreview, stopAsking?: boolean) => Promise<void>
  deleteAsset: (asset: SaveAsset, scope: SaveDeleteScope) => Promise<void>
  /**
   * The push waiting on an answer — from the button, or handed back by a launch
   * that held the session's files instead of uploading them. Both ask the same
   * question about the same kind of list, so both use this.
   */
  confirmingPush: SavePushPreview | null
  setConfirmingPush: (preview: SavePushPreview | null) => void
  /** The row whose delete was asked for, awaiting which end and an answer. */
  deleting: SaveAsset | null
  setDeleting: (asset: SaveAsset | null) => void
  /** The conflict dialog's list, first one showing. Null while it is closed. */
  conflicts: OpenConflicts | null
  /** Open the dialog on this game's conflicts, or say there are none. */
  openConflicts: () => Promise<void>
  answerConflict: (answer: ConflictAnswer) => Promise<void>
  closeConflicts: () => void
} {
  const { t } = useI18n()
  const { notify, offline, settings, saveSettings, unsentSaves } = useApp()
  // Read rather than asked for: the main process pushes this list whenever it
  // changes, so a push made here updates it without this hook refetching.
  const waiting = unsentSaves.some((game) => game.romId === romId)
  const [assets, setAssets] = useState<SaveAsset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<SaveProgress | null>(null)
  const [confirmingPush, setConfirmingPush] = useState<SavePushPreview | null>(null)
  const [deleting, setDeleting] = useState<SaveAsset | null>(null)
  const [conflicts, setConflicts] = useState<OpenConflicts | null>(null)
  /**
   * Conflicts already answered while the dialog has been open, by path.
   *
   * A skip moves nothing, so the next listing still has the file in it; and one
   * whose answer failed is still a conflict. Both wait for the next time the
   * dialog is opened.
   */
  const passed = useRef(new Set<string>())
  /** An answer being carried out. The dialog's buttons stay live; see `ConflictDialog`. */
  const answering = useRef(false)

  /**
   * This game's saves on both sides, refetched after every pull or push so the
   * list is never one action out of date.
   */
  /** Which listing this is, so a slower earlier one cannot land last. */
  const run = useRef(0)
  const reload = useCallback(async (): Promise<void> => {
    // Asked either way: the list falls back to the end that is on this disk,
    // with each row marked as uncompared rather than as absent from the server.
    // See `SaveSync.remoteEnds`. Not before the first connection answer, only
    // because there is no reason to ask twice. See `AppState.offline`.
    if (offline === null) return
    const mine = (run.current += 1)
    // Null rather than an empty list where the call failed. The two are read
    // differently on purpose: the Saves tab draws `saves.empty` — "no saves for
    // this game, here or on RomM" — for an empty array and then advises playing
    // it, which is how a stale local save gets pushed over a good remote one.
    const listed = await window.rommix.saves.list(romId).catch(() => null)
    // The same guard the paging hooks have. Two games opened in quick
    // succession, and this list decides what every save button acts on.
    if (run.current === mine) setAssets(listed)
  }, [romId, offline])

  useEffect(() => {
    setAssets(null)
    void reload()
  }, [reload])

  /**
   * How the transfer in flight is getting on.
   *
   * Filtered by game rather than trusted: the main process broadcasts to every
   * window, and a push started from one game's page must not draw a bar on
   * another's. Each run clears it when it ends, so what is left is only ever
   * the one this screen asked for.
   *
   * Cleared as the screen moves too, because the screen is one component for
   * every game it shows: a transfer left running while its versions list is
   * used to open another dump would otherwise go on drawing its bar there.
   */
  useEffect(() => {
    setProgress(null)
    return window.rommix.saves.onProgress((next) => {
      if (next.romId === romId) setProgress(next)
    })
  }, [romId])

  /**
   * Move saves by hand, in either direction.
   *
   * The automatic sync happens around a launch, which leaves two real gaps
   * this fills: a save made on another device is not wanted *now* unless the
   * game is about to be played here, and a save made before RomMix was
   * installed is never picked up at all, because the post-session push only
   * looks at what the session wrote.
   */
  const syncSaves = async (direction: 'pull' | 'push'): Promise<void> => {
    setBusy(true)
    try {
      const result =
        direction === 'pull'
          ? await window.rommix.saves.pull(romId)
          : await window.rommix.saves.push(romId)
      const to = subject()

      if (result.skippedReason) {
        notify(result.skippedReason, 'warn', to)
      } else if (result.failed > 0) {
        /**
         * Files one end would not give up or the other would not take.
         *
         * Said before the counts below, because those cannot say it: a run
         * where every file failed moves nothing, and "nothing was sent" or
         * "nothing newer on RomM" reads as "there was nothing to do" — the
         * opposite of what happened. The file names and the reason are in the
         * log; the count is what fits in a notification. See
         * `SaveSyncResult.failed`.
         */
        notify(
          t(direction === 'pull' ? 'error.savesNotFetched' : 'error.savesNotSent', {
            count: result.failed
          }),
          'warn',
          to
        )
      } else {
        const moved = result.saves + result.states
        notify(
          moved === 0
            ? direction === 'pull'
              ? t('saves.nothingNewer')
              : t('saves.noLocalSaves')
            : direction === 'pull'
              ? t('saves.pulled', { count: moved })
              : t('saves.pushed', { count: moved }),
          'ok',
          to
        )
      }
      await reload()
      if (direction === 'push' && result.failed > 0) await showConflicts(false)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /**
   * The Push saves button, which may have a question in front of it.
   *
   * The preview is fetched only when the setting is on, so the default path is
   * the single call it has always been. A preview with nothing in it never
   * becomes a dialog: there is no decision to take, and a message saying why
   * is more use than an empty list.
   */
  const beginPush = async (alwaysAsk = false): Promise<void> => {
    if (!alwaysAsk && settings?.confirmSavePush !== true) {
      await syncSaves('push')
      return
    }

    setBusy(true)
    try {
      const preview = await window.rommix.saves.pushPreview(romId)
      // Everything on disk is already on RomM — the push equivalent of a pull
      // that finds nothing newer, and not a warning: the saves exist, they have
      // simply all been sent.
      if (preview.files.length === 0 && preview.inSync > 0) {
        notify(t('saves.allInSync'), 'ok', subject())
        return
      }
      if (preview.files.length === 0) {
        notify(preview.skippedReason ?? t('saves.noLocalSaves'), 'warn', subject())
        return
      }
      setConfirmingPush(preview)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Send the approved files, and only those.
   *
   * By path rather than by "push everything again": the list was read and
   * agreed to, and a second scan could have picked up a file written while the
   * dialog was open — which would be an upload nobody was shown.
   */
  const sendPush = async (preview: SavePushPreview, stopAsking = false): Promise<void> => {
    setConfirmingPush(null)
    setBusy(true)
    try {
      // Before the push, and said out loud: the answer is about every future
      // session, not about this upload, so a push that fails must not take the
      // setting down with it, and a toggle that flips in Settings with nothing
      // on screen reads as a button that did something else.
      if (stopAsking) {
        await saveSettings({ confirmSavePush: false })
        notify(t('saves.noAskAgain'))
      }
      const result = await window.rommix.saves.pushSelected(
        romId,
        preview.files.map((file) => file.path)
      )
      const moved = result.saves + result.states
      // The same order as above: a refusal outranks the count, which cannot
      // describe it.
      const wrong =
        result.skippedReason ??
        (result.failed > 0 ? t('error.savesNotSent', { count: result.failed }) : null)
      notify(
        wrong ?? (moved === 0 ? t('saves.nothingSent') : t('saves.pushed', { count: moved })),
        wrong || moved === 0 ? 'warn' : 'ok',
        subject()
      )
      await reload()
      if (result.failed > 0) await showConflicts(false)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /**
   * Remove one save or state from the one end the button named.
   *
   * The other copy is deliberately left alone — that is what makes "delete the
   * bad one here, then pull RomM's" possible — so the list is reloaded
   * afterwards and the row comes back with the badge for whichever end is left.
   */
  const deleteAsset = async (asset: SaveAsset, scope: SaveDeleteScope): Promise<void> => {
    setDeleting(null)
    setBusy(true)
    try {
      await window.rommix.saves.remove(romId, asset.kind, asset.id, asset.fileName, scope)
      notify(
        t('saves.deleted', {
          file: asset.fileName,
          where: deleteScopeLabel(scope, t)
        })
      )
      await reload()
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * This game's conflicts as RomM stands now, less those already answered.
   *
   * Taken from a fresh push preview each time, so the dialog only ever shows a
   * pair as the two ends hold it this minute: after an answer, the file it
   * settled is in sync and drops out on its own.
   */
  const currentConflicts = async (): Promise<OpenConflicts> => {
    const preview = await window.rommix.saves.pushPreview(romId)
    return {
      list: conflictsIn(preview.files).filter((file) => !passed.current.has(file.path)),
      deviceName: preview.deviceName,
      answered: passed.current.size
    }
  }

  /**
   * Put the conflicts in front of the player, if there are any.
   *
   * `sayNone` for the button that asked: there, finding nothing is an answer
   * worth giving. After a push that failed it is not, since the failure has
   * already been said and a refusal that was not a conflict has no dialog.
   */
  const showConflicts = async (sayNone: boolean): Promise<void> => {
    passed.current = new Set()
    const found = await currentConflicts()
    if (found.list.length > 0) setConflicts(found)
    else if (sayNone) notify(t('conflict.none'), 'ok', subject())
  }

  const openConflicts = async (): Promise<void> => {
    setBusy(true)
    try {
      await showConflicts(true)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Carry out the answer to the conflict on show, then move to the next.
   *
   * Only these three answers act, and only on the one pair the dialog showed:
   * the choice names that file's path or that RomM copy's id, never the game.
   * A keep is believed only when something actually moved: a path the fresh
   * scan no longer finds comes back as nothing failed and nothing sent, and
   * reading that as kept would tell the player a save is safe on RomM when it
   * never left.
   */
  const answerConflict = async (answer: ConflictAnswer): Promise<void> => {
    const open = conflicts
    const current = open?.list[0]
    if (!open || !current || answering.current) return
    answering.current = true
    setBusy(true)
    try {
      if (answer !== 'skip') {
        const choice: ConflictChoice =
          answer === 'device'
            ? { keep: 'device', path: current.path }
            : { keep: 'romm', kind: current.kind, id: current.replaces?.id ?? -1 }
        const result = await window.rommix.saves.resolve(romId, choice).catch(() => null)
        const kept = result !== null && result.failed === 0 && result.saves + result.states > 0
        notify(
          t(
            kept
              ? answer === 'device'
                ? 'conflict.keptDevice'
                : 'conflict.keptRomm'
              : 'conflict.notKept',
            { file: current.fileName }
          ),
          kept ? 'ok' : 'warn',
          subject()
        )
      }
      // Every answered pair, kept or not: one that failed is still a conflict,
      // and putting it straight back in front of the player would ask the
      // question they just answered.
      passed.current.add(current.path)
      const next = await currentConflicts().catch(() => null)
      // The rest of the list as it was, where RomM could not be asked again:
      // the answered one is still dropped, and the others are still questions.
      const rest = next ?? {
        ...open,
        list: open.list.filter((file) => file.path !== current.path),
        answered: passed.current.size
      }
      setConflicts(rest.list.length > 0 ? rest : null)
    } finally {
      answering.current = false
      setBusy(false)
      setProgress(null)
    }
    // Outside the guard: the next question is already on screen, and an answer
    // given while the Saves tab catches up is the player's to have heard. A
    // later refresh overtaking this one is what `run` is for.
    await reload()
  }

  return {
    assets,
    waiting,
    reload,
    busy,
    progress,
    syncSaves,
    beginPush,
    sendPush,
    deleteAsset,
    confirmingPush,
    setConfirmingPush,
    deleting,
    setDeleting,
    conflicts,
    openConflicts,
    answerConflict,
    closeConflicts: () => setConflicts(null)
  }
}
