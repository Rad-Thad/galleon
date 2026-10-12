import type { JSX } from 'react'
import type { PendingSave } from '@shared/types'
import { FocusButton, Overlay } from '../../components'
import { Icon } from '../../icons'
import { useI18n } from '../../state'

/** One of the three answers, by the word the buttons and the tests know it by. */
export type ConflictAnswer = 'device' | 'romm' | 'skip'

/**
 * One save this device and RomM disagree about, and the player's three answers.
 *
 * Two columns rather than a sentence, because the question is which of two
 * things to keep and the answer is read off their dates, sizes and where each
 * came from — side by side is how two things are compared.
 *
 * Nothing on it acts except the three buttons. A conflict is never resolved by
 * where the highlight lands, by B, or by anything around the dialog: B closes it
 * and moves nothing, the same as Skip on every conflict left.
 *
 * The buttons stay mounted from one conflict to the next and are never
 * disabled while an answer is on its way, which is what keeps the highlight on
 * the answer just given when the list moves under it. A disabled button drops
 * the highlight, and the focus system then hands it to a neighbour: on this
 * dialog that is a different answer about a different save. Presses that land
 * while one is still being carried out are dropped by the caller instead.
 */
export function ConflictDialog({
  conflict,
  position,
  total,
  deviceName,
  onAnswer,
  onClose
}: {
  conflict: PendingSave
  /** Which of the conflicts this is, counting from one. */
  position: number
  total: number
  /** What RomM calls this device, for its column. */
  deviceName: string
  onAnswer: (answer: ConflictAnswer) => void
  onClose: () => void
}): JSX.Element {
  const { t, formatBytes, formatDateTime } = useI18n()
  const remote = conflict.replaces

  return (
    <Overlay title={t('conflict.title', { position, total })} icon="saves" onDismiss={onClose}>
      <p className="muted">
        <span className="asset__kind" data-kind={conflict.kind}>
          {conflict.kind === 'save' ? t('asset.save') : t('asset.state')}
        </span>{' '}
        <span className="conflict__file">{conflict.fileName}</span>
      </p>
      <div className="conflict" data-conflict={conflict.path}>
        <section className="conflict__side" data-side="device">
          <h3>
            <Icon name="device" size={16} />
            {t('conflict.thisDevice')}
          </h3>
          <p className="conflict__who">{deviceName}</p>
          <p>{formatDateTime(conflict.modifiedAt) ?? ''}</p>
          <p className="muted">{formatBytes(conflict.sizeBytes)}</p>
        </section>
        <section className="conflict__side" data-side="romm">
          <h3>
            <Icon name="server" size={16} />
            {t('conflict.romm')}
          </h3>
          <p className="conflict__who">{remote?.originName ?? t('push.anotherDevice')}</p>
          <p>{remote ? (formatDateTime(remote.updatedAt) ?? '') : ''}</p>
          <p className="muted">{remote ? formatBytes(remote.sizeBytes) : ''}</p>
        </section>
      </div>
      <p className="muted">{t('conflict.body')}</p>
      <div className="btn-row">
        <FocusButton icon="push" action="conflict-keep-device" onSelect={() => onAnswer('device')}>
          {t('conflict.keepDevice')}
        </FocusButton>
        <FocusButton icon="pull" action="conflict-keep-romm" onSelect={() => onAnswer('romm')}>
          {t('conflict.keepRomm')}
        </FocusButton>
        {/* Focused on arrival: the answer that moves nothing is the one a
            question about somebody's progress opens on. */}
        <FocusButton icon="next" action="conflict-skip" onSelect={() => onAnswer('skip')} autoFocus>
          {t('conflict.skip')}
        </FocusButton>
      </div>
    </Overlay>
  )
}
