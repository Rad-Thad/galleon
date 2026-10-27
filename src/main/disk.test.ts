/**
 * What is asked of the filesystem, and what is done with folders that are not
 * there yet.
 *
 * The figures themselves belong to the machine the suite is running on, so what
 * is asserted is their shape — free below total, neither negative — and the two
 * behaviours that are RomMix's own: a folder that does not exist answers for
 * the drive it would be created on, and two folders on one drive are one drive.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drivesOf, fits, spaceOf } from './disk.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-disk-test-'))
  scratches.push(dir)
  return dir
}

test('what fits is what the room can hold, to the byte', () => {
  assert.equal(fits(10, 11), true)
  assert.equal(fits(10, 10), true)
  assert.equal(fits(10, 9), false)
})

test('a game of no declared size fits, or it could never be fetched', () => {
  // What RomM reports for a game it has no size for. Refusing those would make
  // the check the reason they cannot be downloaded.
  assert.equal(fits(0, 0), true)
})

test('a folder that exists reports its drive', async () => {
  const space = await spaceOf(scratch())

  assert.ok(space)
  assert.ok(space.totalBytes > 0)
  assert.ok(space.freeBytes >= 0)
  assert.ok(space.freeBytes <= space.totalBytes)
})

test('a folder that does not exist yet answers for the drive above it', async () => {
  const dir = scratch()
  const missing = join(dir, 'roms', 'genesis')

  const space = await spaceOf(missing)

  assert.ok(space)
  assert.ok(space.totalBytes > 0)
  // The path asked about, not the one measured: it is what the screen says.
  assert.equal(space.path, missing)
})

test('a relative path is nothing: it would answer for the wrong drive', async () => {
  assert.equal(await spaceOf('relative/and/never/created'), null)
})

test('folders on one drive are one drive', async () => {
  const dir = scratch()

  const drives = await drivesOf([dir, join(dir, 'roms'), join(dir, 'saves')])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].path, dir)
})

test('nothing measurable is an empty list', async () => {
  assert.deepEqual(await drivesOf(['relative/one', 'relative/two']), [])
})

test('the drives are in the order they were asked about', async () => {
  const first = scratch()
  const second = scratch()

  const drives = await drivesOf([first, second])

  // One entry on a machine where both scratches are on the same filesystem,
  // which is the usual case and the one the dedupe is for; two where /tmp is
  // its own mount. Either way the first folder asked about leads.
  assert.equal(drives[0].path, first)
})

test('each drive names the volume it is on', async () => {
  const dir = realpathSync(scratch())
  writeFileSync(join(dir, 'mounts'), `/dev/mmcblk0p1 ${dir} ext4 rw 0 0\n`)

  const [drive] = await drivesOf([join(dir, 'roms', 'gc')], {
    mountsFile: join(dir, 'mounts'),
    byLabelDir: join(dir, 'no-labels')
  })

  // The folder that does not exist yet is named by the volume it would be made on.
  assert.deepEqual(drive.volume, { mountPoint: dir, fsType: 'ext4', label: null })
})

test('a drive on no known mount is still measured, without a volume', async () => {
  const dir = scratch()

  const [drive] = await drivesOf([dir], { mountsFile: join(dir, 'missing') })

  assert.ok(drive.totalBytes > 0)
  assert.equal(drive.volume, undefined)
})

test("on this machine, a drive's volume comes from the kernel's mount table", async () => {
  // Every Linux has a mount covering a scratch folder, if only `/`.
  const [drive] = await drivesOf([scratch()])
  assert.ok(drive.volume?.mountPoint.startsWith('/'))
  assert.ok(drive.volume?.fsType)
})
