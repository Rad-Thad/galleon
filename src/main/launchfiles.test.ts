import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launcherDir, writeLaunchFiles } from './launchfiles.ts'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'galleon-launchfiles-'))

test('launch files are written whole into a folder of the emulator own', async () => {
  const dir = launcherDir('retroarch', scratch())
  await writeLaunchFiles(dir, [{ name: 'append.cfg', content: 'a = "1"\n' }])
  await writeLaunchFiles(dir, [{ name: 'append.cfg', content: 'a = "2"\n' }])
  assert.equal(readFileSync(join(dir, 'append.cfg'), 'utf8'), 'a = "2"\n')
  assert.deepEqual(readdirSync(dir), ['append.cfg'])
})

test('a name that is a path or hidden is refused, and nothing is written', async () => {
  const dir = join(scratch(), 'launch')
  for (const name of ['../retroarch.cfg', 'sub/file.cfg', '', '.hidden']) {
    await assert.rejects(
      () => writeLaunchFiles(dir, [{ name, content: 'x' }]),
      /not a plain file name/
    )
  }
  assert.deepEqual(readdirSync(dir), [])
})

test('no files make no folder', async () => {
  const dir = join(scratch(), 'launch')
  await writeLaunchFiles(dir, [])
  assert.throws(() => readdirSync(dir))
})
