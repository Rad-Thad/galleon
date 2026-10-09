#!/usr/bin/env node
//
// The device test bundle the bridge on the Nova downloads beside the AppImage,
// and the `build-info.json` that names the commit both were built from — see
// docs/PLAN.md section 5.
//
//   node scripts/device-bundle.mjs --sha <40-hex> [--out dist]
//
// Writes `<out>/galleon-device-tests.tar.gz` and `<out>/build-info.json`. The
// bundle holds `test/device/` at its root, the same `build-info.json`, and
// `bridge/`, the device bridge from the same commit for its self-update.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUNDLE_NAME = 'galleon-device-tests.tar.gz'
export const BUILD_INFO_NAME = 'build-info.json'

/**
 * What of tools/device-bridge/ the bridge's `install.sh --update` installs.
 * Its tests and the Mac-side extras stay behind: they never run on the device.
 */
export const BRIDGE_FILES = [
  'galleon_device_bridge.py',
  'galleon-device-bridge',
  'install.sh',
  'VERSION.json',
  'config.example',
  'README.md',
  'systemd'
]

const SHA = /^[0-9a-f]{40}$/

/** The build-info.json the bridge reads the tested commit from. */
export function buildInfo({ sha, version, builtAt, bundleContract }) {
  if (!SHA.test(sha)) throw new Error(`--sha must be a 40-character commit, not ${sha}`)
  if (!Number.isInteger(bundleContract)) throw new Error('bundle.json has no integer contract')
  return { sha, version, builtAt, bundleContract }
}

export function writeBundle({ root, out, sha, builtAt = new Date().toISOString() }) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const manifest = JSON.parse(readFileSync(join(root, 'test/device/bundle.json'), 'utf8'))
  const info = buildInfo({ sha, version, builtAt, bundleContract: manifest.contract })
  const text = `${JSON.stringify(info, null, 2)}\n`

  const stage = mkdtempSync(join(tmpdir(), 'device-bundle-'))
  try {
    cpSync(join(root, 'test/device'), stage, { recursive: true })
    for (const name of BRIDGE_FILES) {
      cpSync(join(root, 'tools/device-bridge', name), join(stage, 'bridge', name), {
        recursive: true
      })
    }
    writeFileSync(join(stage, BUILD_INFO_NAME), text)
    mkdirSync(out, { recursive: true })
    // Owner, times and order fixed, so the same commit packs to the same bytes
    // and SHA256SUMS changes only when the content does.
    execFileSync('tar', [
      '--create',
      '--gzip',
      '--file',
      resolve(out, BUNDLE_NAME),
      '--directory',
      stage,
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '.'
    ])
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  writeFileSync(join(out, BUILD_INFO_NAME), text)
  return info
}

function main(argv) {
  const args = { out: 'dist' }
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (flag === '--sha') args.sha = value
    else if (flag === '--out') args.out = value
    else throw new Error(`unknown option ${flag}`)
  }
  const root = resolve(import.meta.dirname, '..')
  const info = writeBundle({ root, out: resolve(args.out), sha: args.sha ?? '' })
  console.log(`${BUNDLE_NAME} and ${BUILD_INFO_NAME} for ${info.sha} (${info.version})`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`device-bundle: ${error.message}`)
    process.exit(1)
  }
}
