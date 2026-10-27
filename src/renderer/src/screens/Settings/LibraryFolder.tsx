import { type JSX, useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryFolderChoice, LibraryMovePlan, LibraryMoveResult } from '@shared/types'
import { FocusButton, Overlay, Spinner, StatusBadge } from '../../components'
import { useApp, useI18n } from '../../state'
import { carried, carriedBytes, listed, moveVerdict } from './librarymove'

/**
 * Where the shared library keeps its games, and moving it somewhere else.
 *
 * A list of the folders on offer rather than a text field: on the Nova the
 * answer is "this device or the card", and a path typed with a pad is a path
 * typed wrong. See `libraryFolderChoices` for what is offered.
 *
 * Choosing one never moves anything by itself. It opens `LibraryMoveNotice`,
 * which shows what would move and its size first, and only its Move button
 * asks the main process to carry the games.
 */
export function LibraryFolder({
  onCurrent
}: {
  /** Told the folder in use whenever the list is read, for the note beside it. */
  onCurrent: (path: string) => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const [choices, setChoices] = useState<LibraryFolderChoice[] | null>(null)
  const [target, setTarget] = useState<LibraryFolderChoice | null>(null)
  const request = useMemo<MoveRequest | null>(
    () =>
      target && {
        title: 'libraryMove.title',
        measure: () => window.rommix.library.planMove(target.libraryRoot),
        carry: () => window.rommix.library.move(target.libraryRoot),
        path: target.path,
        settingOnly: true,
        stopped: 'libraryMove.stopped'
      },
    [target]
  )

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.rommix.library.folders()
      setChoices(next)
      const current = next.find((choice) => choice.current)
      if (current) onCurrent(current.path)
    } catch {
      // Reported centrally on `app:error`.
    }
  }, [onCurrent])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Stable, because the notice asks for its plan again whenever it changes.
  const close = useCallback((): void => {
    setTarget(null)
    void refresh()
  }, [refresh])

  return (
    <>
      <h2 className="section-title">{t('settings.libraryFolder')}</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        {t('settings.libraryFolderHint')}
      </p>
      {!choices ? (
        <Spinner />
      ) : (
        choices.map((choice) => (
          <div className="setting" key={choice.libraryRoot} data-folder={choice.libraryRoot}>
            <div className="setting__text">
              <div className="setting__label">
                {choice.label === null
                  ? t('settings.libraryInternal')
                  : t('settings.libraryCard', { label: choice.label })}
              </div>
              <div className="setting__hint">
                {choice.freeBytes === null
                  ? choice.path
                  : `${choice.path} · ${t('settings.libraryFree', { size: formatBytes(choice.freeBytes) })}`}
              </div>
            </div>
            {choice.current ? (
              <StatusBadge tone="ok" icon="confirm" label={t('settings.libraryInUse')} />
            ) : (
              <FocusButton
                icon="folder"
                action="library-move-here"
                onSelect={() => setTarget(choice)}
              >
                {t('settings.libraryMoveHere')}
              </FocusButton>
            )}
          </div>
        ))
      )}

      {request ? <LibraryMoveNotice request={request} onClose={close} /> : null}
    </>
  )
}

/**
 * A move the confirmation asks about: the library to another folder, or stock
 * RomMix's games into the library.
 */
export interface MoveRequest {
  title: 'libraryMove.title' | 'stockLibrary.moveTitle'
  /** Sizes every game off the disk; nothing moves. */
  measure: () => Promise<LibraryMovePlan>
  carry: () => Promise<LibraryMoveResult>
  /** Where the games end up, as the toast names it. */
  path: string
  /**
   * Whether a plan with nothing to carry can still be agreed to. Only a folder
   * change has a setting to change; with nothing to carry, stock's games have
   * nothing to ask about.
   */
  settingOnly: boolean
  /** What a move that stopped part-way says, and how to carry on. */
  stopped: 'libraryMove.stopped' | 'stockLibrary.stopped'
}

/**
 * The plan for a move, asked about before anything moves, then the move.
 *
 * Four stages in one panel, so the highlight never leaves it between the
 * question and the answer:
 *
 *  - measuring: `library:planMove` sizes every game off the disk, which on a
 *    card full of disc images is not instant;
 *  - the plan: what moves, how big, what stays and why, and Move only where
 *    `moveVerdict` says the main process would carry it out;
 *  - moving: no way out, B included. A move is carried out game by game and
 *    is safe to stop only between games, which the main process decides; a
 *    panel put away mid-move would leave Settings, the downloads and a second
 *    move reachable over a library that is half in each folder;
 *  - a move that stopped part-way: what it stopped at, and that asking again
 *    carries on. One that finished closes the panel and says so in a toast.
 */
export function LibraryMoveNotice({
  request,
  onClose
}: {
  /** Stable: the plan is measured again whenever it changes. */
  request: MoveRequest
  onClose: () => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { notify, reloadSettings } = useApp()
  const [plan, setPlan] = useState<LibraryMovePlan | null>(null)
  const [moving, setMoving] = useState(false)
  const [stopped, setStopped] = useState<LibraryMoveResult | null>(null)

  useEffect(() => {
    let live = true
    request.measure().then(
      (next) => {
        if (live) setPlan(next)
      },
      // Reported centrally on `app:error`; there is nothing to ask about.
      () => {
        if (live) onClose()
      }
    )
    return () => {
      live = false
    }
  }, [request, onClose])

  const move = async (): Promise<void> => {
    if (!plan) return
    setMoving(true)
    let change: LibraryMoveResult
    try {
      change = await request.carry()
    } catch {
      // Refused, or stopped by an index that would not take a game; either way
      // the setting is unchanged. Reported centrally on `app:error`.
      onClose()
      return
    } finally {
      // The setting may have changed even when the move did not finish.
      await reloadSettings().catch(() => undefined)
      setMoving(false)
    }
    if (change.leftovers.length > 0) {
      notify(
        t('libraryMove.leftovers', {
          count: change.leftovers.length,
          paths: change.leftovers.join(', ')
        }),
        'warn'
      )
    }
    if (change.failed) {
      setStopped(change)
      return
    }
    notify(
      change.moved.length > 0
        ? t('libraryMove.done', { count: change.moved.length, path: request.path })
        : t('libraryMove.doneSetting', { path: request.path }),
      'ok'
    )
    onClose()
  }

  if (stopped?.failed) {
    const at = plan?.games.find((game) => game.romId === stopped.failed?.romId)
    return (
      <Overlay title={t('libraryMove.stoppedTitle')} icon="warn" onDismiss={onClose}>
        <p className="muted">
          {t(request.stopped, {
            name: at?.name ?? String(stopped.failed.romId),
            reason: stopped.failed.reason,
            path: plan?.from ?? ''
          })}
        </p>
        <div className="btn-row">
          <FocusButton icon="confirm" action="library-move-close" onSelect={onClose} autoFocus>
            {t('action.close')}
          </FocusButton>
        </div>
      </Overlay>
    )
  }

  if (!plan || moving) {
    return (
      // Measuring can be put away, since nothing has moved yet; moving cannot.
      <Overlay title={t(request.title)} icon="folder" onDismiss={moving ? undefined : onClose}>
        {moving && plan ? (
          <p className="muted">{t('libraryMove.moving', { count: carried(plan).length })}</p>
        ) : (
          <p className="muted">{t('libraryMove.planning')}</p>
        )}
        <Spinner />
      </Overlay>
    )
  }

  const verdict = moveVerdict(plan)
  const games = carried(plan)
  const taken = new Set(plan.taken)
  const shown = listed(plan)

  return (
    <Overlay title={t(request.title)} icon="folder" onDismiss={onClose}>
      {verdict === 'refused' ? <p className="muted">{t('error.libraryMoveInside')}</p> : null}
      {verdict === 'no-room' ? (
        <p className="muted">
          {t('libraryMove.noRoom', {
            size: formatBytes(plan.totalBytes),
            free: plan.freeBytes === null ? '—' : formatBytes(plan.freeBytes)
          })}
        </p>
      ) : null}
      {verdict === 'setting-only' ? (
        <p className="muted">
          {t(request.settingOnly ? 'libraryMove.settingOnly' : 'stockLibrary.nothingToCarry')}
        </p>
      ) : null}
      {verdict === 'move' ? (
        <>
          <p className="muted">
            {t('libraryMove.body', {
              count: games.length,
              size: formatBytes(carriedBytes(plan)),
              from: plan.from,
              to: plan.to
            })}
          </p>
          <ul className="notice__list muted">
            <li>{t(plan.sameDrive ? 'libraryMove.sameDrive' : 'libraryMove.otherDrive')}</li>
            {plan.freeBytes === null ? null : (
              <li>{t('libraryMove.free', { size: formatBytes(plan.freeBytes) })}</li>
            )}
          </ul>
        </>
      ) : null}
      {verdict === 'refused' ? null : (
        <>
          {plan.games.length > 0 ? (
            <ul className="asset-list" data-games>
              {shown.games.map((game) => (
                <li key={game.romId} data-rom={game.romId} data-taken={taken.has(game.romId)}>
                  <span className="asset__name">{game.name}</span>
                  <span className="asset__meta">
                    {taken.has(game.romId) ? t('libraryMove.stays') : formatBytes(game.sizeBytes)}
                  </span>
                </li>
              ))}
              {shown.more > 0 ? (
                <li>
                  <span className="asset__name faint">
                    {t('libraryMove.more', { count: shown.more })}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
          <ul className="notice__list muted">
            {plan.taken.length > 0 ? (
              <li>{t('libraryMove.taken', { count: plan.taken.length })}</li>
            ) : null}
            {plan.missing.length > 0 ? (
              <li>{t('libraryMove.missing', { count: plan.missing.length })}</li>
            ) : null}
          </ul>
        </>
      )}
      <div className="btn-row">
        {/* Staying put is focused, not the move: the folder has just been
            chosen, so the press that lands here is one press away from
            agreeing to whatever the list above is explaining. */}
        <FocusButton icon="cancel" action="library-move-keep" onSelect={onClose} autoFocus>
          {t('libraryMove.keep')}
        </FocusButton>
        {verdict === 'move' || (verdict === 'setting-only' && request.settingOnly) ? (
          <FocusButton
            icon="confirm"
            action="library-move-confirm"
            variant="primary"
            onSelect={() => void move()}
          >
            {t(verdict === 'move' ? 'libraryMove.confirm' : 'libraryMove.confirmSetting')}
          </FocusButton>
        ) : null}
      </div>
    </Overlay>
  )
}
