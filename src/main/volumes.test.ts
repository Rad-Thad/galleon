/**
 * Reading the mounted volumes: the mount table and udev's label links as the
 * kernel and udev write them, and a reader pointed at fixtures in a scratch
 * folder, since a test machine has no card in it.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chooseLibraryVolume } from '@shared/librarycard'
import {
  decodeLabelLink,
  isMediaMount,
  mountOf,
  parseMounts,
  readVolumes,
  volumeNamer
} from './volumes.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  // Resolved, since a folder asked about is matched to its mount once resolved.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'galleon-volumes-test-')))
  scratches.push(dir)
  return dir
}

test('the mount table gives each mount its device, type and whether it is read-only', () => {
  const mounts = parseMounts(
    [
      'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0',
      '/dev/nvme0n1p8 /home ext4 rw,relatime 0 0',
      '/dev/mmcblk0p1 /run/media/deck/NovaSD ext4 rw,nosuid,nodev,relatime,errors=remount-ro 0 0',
      '/dev/sda1 /run/media/deck/STICK vfat ro,nosuid,nodev,relatime,fmask=0022 0 0',
      ''
    ].join('\n')
  )
  assert.deepEqual(mounts, [
    { device: 'proc', mountPoint: '/proc', fsType: 'proc', readOnly: false },
    { device: '/dev/nvme0n1p8', mountPoint: '/home', fsType: 'ext4', readOnly: false },
    {
      device: '/dev/mmcblk0p1',
      mountPoint: '/run/media/deck/NovaSD',
      fsType: 'ext4',
      // `errors=remount-ro` says what happens on an error, not that it is read-only.
      readOnly: false
    },
    { device: '/dev/sda1', mountPoint: '/run/media/deck/STICK', fsType: 'vfat', readOnly: true }
  ])
})

test("the kernel's escapes in a path are undone", () => {
  const [mount] = parseMounts(
    '/srv/My\\040Share /run/media/deck/My\\040Card\\011\\134x ext4 rw 0 0'
  )
  assert.equal(mount.mountPoint, '/run/media/deck/My Card\t\\x')
  // The kernel escapes the source field the same way, whatever names it.
  assert.equal(mount.device, '/srv/My Share')
})

test('a mount point mounted over is the later mount, listed once', () => {
  const mounts = parseMounts(
    [
      '/dev/sda1 /run/media/deck/NovaSD vfat rw 0 0',
      '/dev/mmcblk0p1 /run/media/deck/NovaSD ext4 ro 0 0'
    ].join('\n')
  )
  assert.deepEqual(mounts, [
    {
      device: '/dev/mmcblk0p1',
      mountPoint: '/run/media/deck/NovaSD',
      fsType: 'ext4',
      readOnly: true
    }
  ])
})

test('a line too short to be a mount is skipped', () => {
  assert.deepEqual(parseMounts('garbage\n/dev/sda1 /mnt\n  \n'), [])
})

test("udev's escapes in a label link are undone", () => {
  assert.equal(decodeLabelLink('NovaSD'), 'NovaSD')
  assert.equal(decodeLabelLink('My\\x20Card\\x2fTwo'), 'My Card/Two')
})

test('only mounts under /run/media are removable media', () => {
  assert.equal(isMediaMount('/run/media/deck/NovaSD'), true)
  assert.equal(isMediaMount('/run/media/mmcblk0p1'), true)
  assert.equal(isMediaMount('/run/media'), false)
  assert.equal(isMediaMount('/run/mediaX/deck/NovaSD'), false)
  assert.equal(isMediaMount('/home'), false)
})

/**
 * A machine in a scratch folder: devices as files, udev's label links to
 * them, and mount points as folders, which `statfs` measures as the drive the
 * scratch folder is on.
 */
function machine(
  lines: (dir: string) => string[],
  labelled: Record<string, string> = {}
): {
  dir: string
  sources: Parameters<typeof readVolumes>[0]
} {
  const dir = scratch()
  mkdirSync(join(dir, 'dev'))
  mkdirSync(join(dir, 'by-label'))
  for (const [link, device] of Object.entries(labelled)) {
    writeFileSync(join(dir, 'dev', device), '')
    symlinkSync(join('..', 'dev', device), join(dir, 'by-label', link))
  }
  writeFileSync(join(dir, 'mounts'), lines(dir).join('\n'))
  return {
    dir,
    sources: {
      mountsFile: join(dir, 'mounts'),
      byLabelDir: join(dir, 'by-label'),
      include: (mountPoint) => mountPoint.startsWith(join(dir, 'media'))
    }
  }
}

test('each card is read with its label, type, room and whether it is read-only', async () => {
  const { dir, sources } = machine(
    (at) => [
      `/dev/nvme0n1p8 ${at} ext4 rw 0 0`,
      `${join(at, 'dev', 'mmcblk0p1')} ${join(at, 'media', 'deck', 'NovaSD')} ext4 rw 0 0`,
      `${join(at, 'dev', 'sda1')} ${join(at, 'media', 'deck', 'My\\040Stick')} vfat ro 0 0`
    ],
    { NovaSD: 'mmcblk0p1', 'My\\x20Stick': 'sda1' }
  )
  mkdirSync(join(dir, 'media', 'deck', 'NovaSD'), { recursive: true })
  mkdirSync(join(dir, 'media', 'deck', 'My Stick'), { recursive: true })

  const volumes = await readVolumes(sources)
  assert.deepEqual(
    volumes.map(({ mountPoint, fsType, label, readOnly }) => ({
      mountPoint,
      fsType,
      label,
      readOnly
    })),
    [
      {
        mountPoint: join(dir, 'media', 'deck', 'NovaSD'),
        fsType: 'ext4',
        label: 'NovaSD',
        readOnly: false
      },
      {
        mountPoint: join(dir, 'media', 'deck', 'My Stick'),
        fsType: 'vfat',
        label: 'My Stick',
        readOnly: true
      }
    ]
  )
  for (const volume of volumes) {
    assert.ok(volume.totalBytes > 0)
    assert.ok(volume.freeBytes >= 0 && volume.freeBytes <= volume.totalBytes)
  }
})

test('a device named through a link of its own still finds its label', async () => {
  const { dir, sources } = machine(
    (at) => [`${join(at, 'by-uuid')} ${join(at, 'media', 'deck', 'NovaSD')} ext4 rw 0 0`],
    { NovaSD: 'mmcblk0p1' }
  )
  symlinkSync(join('dev', 'mmcblk0p1'), join(dir, 'by-uuid'))
  mkdirSync(join(dir, 'media', 'deck', 'NovaSD'), { recursive: true })

  const [volume] = await readVolumes(sources)
  assert.equal(volume.label, 'NovaSD')
})

test('a card with no label link has no label', async () => {
  const { dir, sources } = machine((at) => [
    `/dev/mmcblk0p1 ${join(at, 'media', 'mmcblk0p1')} ext4 rw 0 0`
  ])
  rmSync(join(dir, 'by-label'), { recursive: true })
  mkdirSync(join(dir, 'media', 'mmcblk0p1'), { recursive: true })

  const [volume] = await readVolumes(sources)
  assert.equal(volume.label, null)
})

test('a mount point that cannot be measured is left out', async () => {
  const { sources } = machine((at) => [
    `/dev/mmcblk0p1 ${join(at, 'media', 'deck', 'Gone')} ext4 rw 0 0`
  ])
  assert.deepEqual(await readVolumes(sources), [])
})

test('mounts outside removable media are not measured', async () => {
  // The default filter, against the machine running the suite: whatever it
  // has mounted, nothing outside /run/media comes back.
  for (const volume of await readVolumes()) assert.ok(isMediaMount(volume.mountPoint))
})

test('no mount table means no volumes, not an error', async () => {
  assert.deepEqual(await readVolumes({ mountsFile: join(scratch(), 'missing') }), [])
})

test('what is read is what chooseLibraryVolume chooses from', async () => {
  const { dir, sources } = machine(
    (at) => [`/dev/mmcblk0p1 ${join(at, 'media', 'deck', 'NovaSD')} ext4 ro 0 0`],
    { NovaSD: 'mmcblk0p1' }
  )
  mkdirSync(join(dir, 'media', 'deck', 'NovaSD'), { recursive: true })
  const volumes = (await readVolumes(sources)).map((volume) => ({
    ...volume,
    mountPoint: volume.mountPoint.replace(join(dir, 'media'), '/run/media')
  }))
  assert.deepEqual(chooseLibraryVolume(volumes, 'deck'), { kind: 'internal', reason: 'read-only' })
})

test('a path is on the deepest mount at or above it', () => {
  const mounts = parseMounts(
    [
      '/dev/nvme0n1p8 / ext4 rw 0 0',
      '/dev/nvme0n1p9 /home ext4 rw 0 0',
      '/dev/mmcblk0p1 /run/media/deck/NovaSD ext4 rw 0 0',
      '/dev/sda1 /run/media/deck/Nova vfat rw 0 0'
    ].join('\n')
  )
  const on = (path: string): string | undefined => mountOf(path, mounts)?.device

  assert.equal(on('/run/media/deck/NovaSD/galleon/roms'), '/dev/mmcblk0p1')
  assert.equal(on('/run/media/deck/NovaSD'), '/dev/mmcblk0p1')
  // A mount point that is only the start of the folder's name is not its mount.
  assert.equal(on('/run/media/deck/NovaSDX/roms'), '/dev/nvme0n1p8')
  assert.equal(on('/home/deck/galleon/roms'), '/dev/nvme0n1p9')
  assert.equal(on('/opt'), '/dev/nvme0n1p8')
  assert.equal(mountOf('/home/deck', parseMounts('/dev/sda1 /run/media/x ext4 rw 0 0')), null)
})

test("a folder's volume is named with its mount point, file system and label", async () => {
  const { dir, sources } = machine(
    (at) => [
      `/dev/nvme0n1p8 ${at} btrfs rw 0 0`,
      `${join(at, 'dev', 'mmcblk0p1')} ${join(at, 'media', 'deck', 'NovaSD')} ext4 rw 0 0`
    ],
    { NovaSD: 'mmcblk0p1' }
  )
  const card = join(dir, 'media', 'deck', 'NovaSD')
  mkdirSync(join(card, 'galleon', 'roms'), { recursive: true })
  mkdirSync(join(dir, 'home'))
  const nameVolume = await volumeNamer(sources)

  assert.deepEqual(await nameVolume(join(card, 'galleon', 'roms')), {
    mountPoint: card,
    fsType: 'ext4',
    label: 'NovaSD'
  })
  assert.deepEqual(await nameVolume(join(dir, 'home')), {
    mountPoint: dir,
    fsType: 'btrfs',
    label: null
  })
})

test('a link to a folder on the card is named by the card', async () => {
  const { dir, sources } = machine((at) => [
    `/dev/nvme0n1p8 ${at} btrfs rw 0 0`,
    `/dev/mmcblk0p1 ${join(at, 'media', 'deck', 'NovaSD')} ext4 rw 0 0`
  ])
  mkdirSync(join(dir, 'media', 'deck', 'NovaSD', 'roms'), { recursive: true })
  symlinkSync(join(dir, 'media', 'deck', 'NovaSD', 'roms'), join(dir, 'roms'))

  const volume = await (await volumeNamer(sources))(join(dir, 'roms'))
  assert.equal(volume?.fsType, 'ext4')
})

test('without a mount table, or off every mount, a folder has no volume', async () => {
  const dir = scratch()
  assert.equal(await (await volumeNamer({ mountsFile: join(dir, 'missing') }))(dir), null)

  const { dir: other, sources } = machine((at) => [
    `/dev/mmcblk0p1 ${join(at, 'media', 'deck', 'NovaSD')} ext4 rw 0 0`
  ])
  assert.equal(await (await volumeNamer(sources))(other), null)
})
