import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Only the player's "keep this device's save" may overwrite a save on RomM.
 *
 * Read from the source rather than trusted to review, as
 * `savewriter.allowlist.test.ts` is: an upload that overwrites replaces another
 * device's newer save without a question (docs/save-sync/SPEC.md section 7), so
 * a new call site that says so has to be named here with the choice behind it.
 */

const SRC = join(import.meta.dirname, '..')

/** Every module allowed to ask for an overwrite, and the choice behind it. */
const ALLOWED: Record<string, string> = {
  'main/saves.ts': "SaveSync.resolve, the player's 'keep this device's save' in a conflict"
}

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) yield path
  }
}

test("nothing but the player's choice asks RomM to overwrite a save", () => {
  const asking: Record<string, number> = {}
  for (const path of sources(SRC)) {
    const source = readFileSync(path, 'utf8')
    const count =
      (source.match(/keepThisDevice:\s*(?!false\b)[\w.!]/g)?.length ?? 0) +
      (source.match(/overwrite['"]?\s*[=:,]\s*['"]?true/g)?.length ?? 0)
    if (count > 0) asking[relative(SRC, path).split('\\').join('/')] = count
  }
  assert.deepEqual(
    Object.keys(asking).sort(),
    Object.keys(ALLOWED).sort(),
    `modules that ask for an overwrite: ${JSON.stringify(asking)}`
  )
})

test('the client sends overwrite only from the option that names the choice', () => {
  const client = readFileSync(join(SRC, 'main/romm/client.ts'), 'utf8')
  const code = client
    .split('\n')
    .filter((line) => line.includes('overwrite') && !/^\s*(\*|\/\/)/.test(line))
    .map((line) => line.trim())
  assert.deepEqual(code, ['overwrite: String(keepThisDevice)'])
})
