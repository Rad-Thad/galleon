import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CARD_MIN_FREE_BYTES,
  chooseLibraryVolume,
  PREFERRED_CARD_LABEL,
  type Volume
} from './librarycard.ts'

const GB = 1024 ** 3

const internal: Volume = {
  mountPoint: '/home',
  fsType: 'btrfs',
  label: null,
  readOnly: false,
  freeBytes: 300 * GB,
  totalBytes: 450 * GB
}
const root: Volume = { ...internal, mountPoint: '/', fsType: 'ext4' }

function card(overrides: Partial<Volume> = {}): Volume {
  return {
    mountPoint: `/run/media/armada/${PREFERRED_CARD_LABEL}`,
    fsType: 'ext4',
    label: PREFERRED_CARD_LABEL,
    readOnly: false,
    freeBytes: 234 * GB,
    totalBytes: 251 * GB,
    ...overrides
  }
}

test('a mounted ext4 card is the default', () => {
  const sd = card()
  assert.deepEqual(chooseLibraryVolume([root, internal, sd], 'armada'), {
    kind: 'card',
    volume: sd
  })
})

test('with no card, the library stays on internal storage', () => {
  assert.deepEqual(chooseLibraryVolume([root, internal], 'armada'), {
    kind: 'internal',
    reason: 'no-card'
  })
  assert.deepEqual(chooseLibraryVolume([], 'armada'), { kind: 'internal', reason: 'no-card' })
})

test('a read-only card is passed over', () => {
  assert.deepEqual(chooseLibraryVolume([internal, card({ readOnly: true })], 'armada'), {
    kind: 'internal',
    reason: 'read-only'
  })
})

test('a nearly full card is passed over; one with just enough room is not', () => {
  assert.deepEqual(
    chooseLibraryVolume([internal, card({ freeBytes: CARD_MIN_FREE_BYTES - 1 })], 'armada'),
    { kind: 'internal', reason: 'nearly-full' }
  )
  assert.equal(
    chooseLibraryVolume([internal, card({ freeBytes: CARD_MIN_FREE_BYTES })], 'armada').kind,
    'card'
  )
})

test('a card that is not ext4 is passed over', () => {
  for (const fsType of ['exfat', 'vfat', 'btrfs', 'fuseblk']) {
    assert.deepEqual(chooseLibraryVolume([internal, card({ fsType })], 'armada'), {
      kind: 'internal',
      reason: 'not-ext4'
    })
  }
})

test('of two cards, the one labelled NovaSD wins even with less room', () => {
  const nova = card({ freeBytes: 20 * GB })
  const other = card({ mountPoint: '/run/media/armada/Games', label: 'Games', freeBytes: 900 * GB })
  assert.deepEqual(chooseLibraryVolume([other, nova], 'armada'), { kind: 'card', volume: nova })
  assert.deepEqual(chooseLibraryVolume([nova, other], 'armada'), { kind: 'card', volume: nova })
})

test('of two cards without the label, the one with more room wins, whatever the order', () => {
  const a = card({ mountPoint: '/run/media/armada/A', label: 'A', freeBytes: 50 * GB })
  const b = card({ mountPoint: '/run/media/armada/B', label: null, freeBytes: 80 * GB })
  assert.deepEqual(chooseLibraryVolume([a, b], 'armada'), { kind: 'card', volume: b })
  assert.deepEqual(chooseLibraryVolume([b, a], 'armada'), { kind: 'card', volume: b })
  const tie = card({ mountPoint: '/run/media/armada/C', label: null, freeBytes: 80 * GB })
  assert.deepEqual(chooseLibraryVolume([tie, b], 'armada'), { kind: 'card', volume: b })
})

test('of two cards, a usable one wins over one passed over', () => {
  const full = card({ freeBytes: GB })
  const usable = card({ mountPoint: '/run/media/armada/Spare', label: 'Spare' })
  assert.deepEqual(chooseLibraryVolume([full, usable], 'armada'), {
    kind: 'card',
    volume: usable
  })
})

test('when no card qualifies, the reason is the nearest miss', () => {
  const exfat = card({ mountPoint: '/run/media/armada/X', label: 'X', fsType: 'exfat' })
  const full = card({ freeBytes: GB })
  assert.deepEqual(chooseLibraryVolume([exfat, full], 'armada'), {
    kind: 'internal',
    reason: 'nearly-full'
  })
})

test("a card mounted the older way, straight under /run/media, counts; another user's does not", () => {
  const old = card({ mountPoint: '/run/media/mmcblk0p1', label: null })
  assert.deepEqual(chooseLibraryVolume([old], 'armada'), { kind: 'card', volume: old })
  assert.equal(
    chooseLibraryVolume([card({ mountPoint: '/run/media/deck/NovaSD' })], 'armada').kind,
    'internal'
  )
})

test('only removable media counts, not the user folder or anything outside /run/media', () => {
  for (const mountPoint of [
    '/run/media/armada',
    '/run/media/armada/',
    '/mnt/NovaSD',
    '/media/NovaSD'
  ]) {
    assert.deepEqual(chooseLibraryVolume([card({ mountPoint })], 'armada'), {
      kind: 'internal',
      reason: 'no-card'
    })
  }
  const deeper = card({ mountPoint: '/run/media/armada/NovaSD/sub' })
  assert.equal(chooseLibraryVolume([deeper], 'armada').kind, 'internal')
})
