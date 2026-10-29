/**
 * The fake RomM as a program, the way run.sh starts it on the Nova: built into
 * one file by `scripts/device-bundle.mjs` and run by the AppImage's own
 * Electron as Node, since the device has no Node of its own.
 *
 *   ELECTRON_RUN_AS_NODE=1 FAKE_ROMM_TOKEN=<token> <electron> fake-romm.cjs \
 *     --rom-ids 1,2 --scratch <dir> --ready <file>
 *
 * The token comes from the environment rather than the command line, which
 * any process on the device can read. Once listening it writes `--ready`, a
 * JSON `{ baseUrl, pid }`, by rename so a reader never sees half of it; the
 * pid is what run.sh records and signals, never a match on command lines.
 * SIGTERM or SIGINT closes the server and exits 0.
 */
import { renameSync, writeFileSync } from 'node:fs'
import { startFakeRomm } from './server.ts'

export interface Options {
  token: string
  romIds: number[]
  scratch: string
  ready: string
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): Options {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (!['--rom-ids', '--scratch', '--ready'].includes(flag) || value === undefined) {
      throw new Error(`unknown option ${flag}`)
    }
    values.set(flag, value)
  }
  const token = env.FAKE_ROMM_TOKEN ?? ''
  if (!token) throw new Error('FAKE_ROMM_TOKEN is not set')
  const romIds = (values.get('--rom-ids') ?? '').split(',').map(Number)
  if (!romIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error('--rom-ids must be positive integers separated by commas')
  }
  const scratch = values.get('--scratch')
  const ready = values.get('--ready')
  if (!scratch || !ready) throw new Error('--scratch and --ready are required')
  return { token, romIds, scratch, ready }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), process.env)
  const server = await startFakeRomm(options)
  const stop = (): void => {
    void server.close().then(() => process.exit(0))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  const partial = `${options.ready}.partial`
  writeFileSync(partial, `${JSON.stringify({ baseUrl: server.baseUrl, pid: process.pid })}\n`)
  renameSync(partial, options.ready)
}

// Run as the program, not when a test imports `parseArgs`.
if (process.argv[1]?.endsWith('fake-romm.cjs') || process.argv[1]?.endsWith('main.ts')) {
  main().catch((error: unknown) => {
    console.error(`fake-romm: ${(error as Error).message}`)
    process.exit(1)
  })
}
