/**
 * Which drive the game library goes on by default.
 *
 * The Nova's SD card is where the owner wants games, and it is not always
 * there: it can be out of the slot, mounted read-only after a bad unmount, or
 * full. This decides from a list of mounted volumes alone, so every one of
 * those cases is a unit test rather than a card in a slot.
 */

/** One mounted file system, as the main process reads it from the machine. */
export interface Volume {
  /** Where it is mounted, e.g. `/run/media/<user>/NovaSD`. */
  mountPoint: string
  /** The file system type as the kernel names it, e.g. `ext4`. */
  fsType: string
  /** The file system's label, or null when it has none. */
  label: string | null
  readOnly: boolean
  /** Free to the user running Galleon. */
  freeBytes: number
  totalBytes: number
}

/** Why a card was passed over, or why there was none to choose. */
export type InternalReason = 'no-card' | 'read-only' | 'nearly-full' | 'not-ext4'

export type LibraryVolume =
  { kind: 'card'; volume: Volume } | { kind: 'internal'; reason: InternalReason }

/** The label of the Nova's own card (DEVICE-FACTS.md), first among several. */
export const PREFERRED_CARD_LABEL = 'NovaSD'

/**
 * Room a card must have left to be the default.
 *
 * A card with less would take the first large disc image and then fail the
 * next, and internal storage is the better default until it is cleared.
 */
export const CARD_MIN_FREE_BYTES = 4 * 1024 ** 3

/**
 * Whether the mount point is where removable media is mounted.
 *
 * udisks mounts a card at `/run/media/<user>/<label>`; older SteamOS images
 * mounted it at `/run/media/<device>` directly. The user folder itself is not
 * a card.
 */
function isCardMount(mountPoint: string, user: string): boolean {
  const parts = mountPoint.replace(/\/+$/, '').split('/').slice(1)
  if (parts[0] !== 'run' || parts[1] !== 'media') return false
  if (parts.length === 4) return parts[2] === user
  return parts.length === 3 && parts[2] !== user
}

/** The volumes that are removable cards, in the order they were listed. */
export function cardVolumes(volumes: readonly Volume[], user: string): Volume[] {
  return volumes.filter((volume) => isCardMount(volume.mountPoint, user))
}

/**
 * The card a fresh install puts its library on, or why it stays internal.
 *
 * Only ext4 counts: SteamOS's automount, and so armadaOS's, mounts only ext4
 * cards, and flatpak emulators are granted `/run/media` either way. A
 * read-only or nearly full card is passed over rather than chosen and failed
 * on later. Of several cards, the one labelled `PREFERRED_CARD_LABEL` wins,
 * then the one with most room; the mount point settles a tie, so the choice
 * does not depend on the order the machine lists its mounts in.
 *
 * When no card qualifies, the reason is the one of the best card passed over,
 * so the app can say why the library is on internal storage.
 */
export function chooseLibraryVolume(volumes: readonly Volume[], user: string): LibraryVolume {
  const cards = cardVolumes(volumes, user)
  if (cards.length === 0) return { kind: 'internal', reason: 'no-card' }

  const usable: Volume[] = []
  let reason: InternalReason = 'no-card'
  const rank: Record<InternalReason, number> = {
    'no-card': 0,
    'not-ext4': 1,
    'read-only': 2,
    'nearly-full': 3
  }
  for (const card of cards) {
    const why: InternalReason | null =
      card.fsType !== 'ext4'
        ? 'not-ext4'
        : card.readOnly
          ? 'read-only'
          : card.freeBytes < CARD_MIN_FREE_BYTES
            ? 'nearly-full'
            : null
    if (why === null) usable.push(card)
    else if (rank[why] > rank[reason]) reason = why
  }
  if (usable.length === 0) return { kind: 'internal', reason }

  const best = [...usable].sort(
    (a, b) =>
      Number(b.label === PREFERRED_CARD_LABEL) - Number(a.label === PREFERRED_CARD_LABEL) ||
      b.freeBytes - a.freeBytes ||
      a.mountPoint.localeCompare(b.mountPoint)
  )[0]
  return { kind: 'card', volume: best }
}
