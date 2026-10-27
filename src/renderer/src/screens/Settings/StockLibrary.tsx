import { type JSX, useCallback, useEffect, useMemo, useState } from 'react'
import type { StockLibraryOffer } from '@shared/types'
import { FocusButton } from '../../components'
import { useApp, useI18n } from '../../state'
import { LibraryMoveNotice, type MoveRequest } from './LibraryFolder'
import { carriedBytes, stockChoices } from './librarymove'

/**
 * The games stock RomMix downloaded before Galleon, offered once and only on
 * request: used where they are, or moved into the library.
 *
 * Nothing shows when there are none for the server signed in to (see
 * `readStockLibrary`). Using them where they are only records them; moving
 * them goes through the same confirmation as a library move, so their sizes
 * and the room for them are shown before anything moves.
 */
export function StockLibrary({ library }: { library: string | null }): JSX.Element | null {
  const { t, formatBytes } = useI18n()
  const { notify } = useApp()
  const [offer, setOffer] = useState<StockLibraryOffer | null>(null)
  /** Where Move was chosen to carry the games: the library as the offer saw it. */
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const [adopting, setAdopting] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setOffer(await window.rommix.library.stock())
    } catch {
      // Reported centrally on `app:error`.
    }
  }, [])

  // Read again when the library folder changes: a move there changes what
  // moving stock's games would carry, and where to.
  useEffect(() => {
    void refresh()
  }, [refresh, library])

  const request = useMemo<MoveRequest | null>(
    () =>
      moveTo === null
        ? null
        : {
            title: 'stockLibrary.moveTitle',
            measure: async () => {
              const next = await window.rommix.library.stock()
              if (!next) throw new Error('stock RomMix has no games to move')
              return next.plan
            },
            carry: () => window.rommix.library.moveStock(),
            path: moveTo,
            settingOnly: false,
            stopped: 'stockLibrary.stopped'
          },
    [moveTo]
  )

  const close = useCallback((): void => {
    setMoveTo(null)
    void refresh()
  }, [refresh])

  if (!offer) return null
  const choices = stockChoices(offer)

  const adopt = async (): Promise<void> => {
    setAdopting(true)
    try {
      const count = await window.rommix.library.adoptStock()
      notify(t('stockLibrary.adopted', { count }), 'ok')
    } catch {
      // Reported centrally on `app:error`.
    } finally {
      setAdopting(false)
      await refresh()
    }
  }

  return (
    <>
      <h2 className="section-title">{t('stockLibrary.title')}</h2>
      <div className="setting" data-stock>
        <div className="setting__text">
          <div className="setting__label">
            {choices.adopt
              ? t('stockLibrary.unknown', { count: offer.adoptable })
              : t('stockLibrary.known', { count: offer.plan.games.length })}
          </div>
          <div className="setting__hint">
            {choices.move
              ? `${offer.plan.from} · ${t('stockLibrary.size', { size: formatBytes(carriedBytes(offer.plan)) })}`
              : offer.plan.from}
          </div>
        </div>
        {choices.adopt ? (
          <FocusButton
            icon="confirm"
            action="stock-adopt"
            disabled={adopting}
            onSelect={() => void adopt()}
          >
            {t('stockLibrary.adopt')}
          </FocusButton>
        ) : null}
        {choices.move ? (
          <FocusButton
            icon="folder"
            action="stock-move"
            disabled={adopting}
            onSelect={() => setMoveTo(offer.plan.to)}
          >
            {t('stockLibrary.move')}
          </FocusButton>
        ) : null}
      </div>
      {request ? <LibraryMoveNotice request={request} onClose={close} /> : null}
    </>
  )
}
