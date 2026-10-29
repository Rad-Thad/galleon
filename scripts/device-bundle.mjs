#!/usr/bin/env node
//
// The device test bundle the bridge on the Nova downloads beside the AppImage,
// and the `build-info.json` that names the commit both were built from — see
// docs/PLAN.md section 5.
//
//   node scripts/device-bundle.mjs --sha <40-hex> [--out dist] [--payloads <dir>]
//
// Writes `<out>/galleon-device-tests.tar.gz` and `<out>/build-info.json`. The
// bundle holds `test/device/` at its root, the same `build-info.json`,
// `bridge/`, the device bridge from the same commit for its self-update,
// `fake-romm/fake-romm.cjs`, the fake RomM built into one file with the
// licences of what it carries beside it, and, with
// `--payloads`, `payloads/`: the homebrew of test/fixtures/roms/
// manifest.json as scripts/agent/fetch-fixtures.mjs put it in that folder.
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { loadManifest, sha256 } from './agent/fetch-fixtures.mjs'

export const BUNDLE_NAME = 'galleon-device-tests.tar.gz'
export const BUILD_INFO_NAME = 'build-info.json'
export const PAYLOADS_DIR = 'payloads'
export const PAYLOAD_MANIFEST = 'test/fixtures/roms/manifest.json'

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

export const FAKE_ROMM = 'fake-romm/fake-romm.cjs'
export const FAKE_ROMM_NOTICES = 'fake-romm/THIRD_PARTY.md'

const SHA = /^[0-9a-f]{40}$/

/**
 * The fake RomM (M2-20) as one CommonJS file with everything it imports,
 * the app's save hash and yauzl among them: the Nova has no Node and no
 * node_modules, only the AppImage's Electron run as Node. CommonJS because
 * yauzl is, and an ES module cannot `require` Node's own modules.
 *
 * The bundle is published, so every package built into the file brings its
 * licence along in `notices`, found from what esbuild actually pulled in
 * rather than from a list that could fall behind; the packages carry no
 * licence comment for `legalComments` to keep. Returns the package names.
 */
export function buildFakeRomm({ root, to, notices }) {
  const { metafile } = buildSync({
    entryPoints: [join(root, 'test/device/fake-romm/main.ts')],
    outfile: to,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    legalComments: 'inline',
    metafile: true,
    logLevel: 'error'
  })
  const packages = [
    ...new Set(
      Object.keys(metafile.inputs)
        .map((input) => /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1])
        .filter((name) => name !== undefined)
    )
  ].sort()
  const parts = ['# Third-party code in fake-romm.cjs\n']
  for (const name of packages) {
    const dir = join(root, 'node_modules', name)
    const licence = readdirSync(dir).find((file) => /^licen[cs]e(\.(md|txt))?$/i.test(file))
    if (!licence) throw new Error(`${name} is built into the fake RomM but ships no licence file`)
    const { version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    parts.push(
      `## ${name} ${version} (${license})\n\n\`\`\`\n${readFileSync(join(dir, licence), 'utf8').trimEnd()}\n\`\`\`\n`
    )
  }
  writeFileSync(notices, parts.join('\n'))
  return packages
}

/** The build-info.json the bridge reads the tested commit from. */
export function buildInfo({ sha, version, builtAt, bundleContract }) {
  if (!SHA.test(sha)) throw new Error(`--sha must be a 40-character commit, not ${sha}`)
  if (!Number.isInteger(bundleContract)) throw new Error('bundle.json has no integer contract')
  return { sha, version, builtAt, bundleContract }
}

/**
 * The `Test payloads` part of THIRD_PARTY.md: each payload's project, licence
 * and licence text, which travel with the files they cover. A heading inside
 * a fenced block is licence text, not the end of the part.
 */
export function payloadNotices(thirdParty) {
  const lines = thirdParty.split('\n')
  const start = lines.findIndex((line) => line.trim() === '# Test payloads')
  if (start < 0) throw new Error('THIRD_PARTY.md has no "# Test payloads" part')
  let fenced = false
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('```')) fenced = !fenced
    else if (!fenced && lines[i].startsWith('# ')) {
      end = i
      break
    }
  }
  return `${lines.slice(start, end).join('\n').trimEnd()}\n`
}

/**
 * Copies every payload the manifest pins from `from` into `<stage>/payloads/`,
 * with the manifest's entries and the licence notices beside them. A payload
 * that is missing, not a plain file, or not the pinned bytes stops the build:
 * the device must never run, or the bundle carry, bytes nobody checked.
 */
export function stagePayloads({ root, from, stage, manifest = join(root, PAYLOAD_MANIFEST) }) {
  const files = loadManifest(manifest)
  const target = join(stage, PAYLOADS_DIR)
  for (const f of files) {
    const source = join(from, f.path)
    let stat
    try {
      stat = lstatSync(source)
    } catch {
      throw new Error(`payload ${f.path} is not in ${from}; fetch it first`)
    }
    if (!stat.isFile()) throw new Error(`payload ${f.path} is not a plain file`)
    const bytes = readFileSync(source)
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) {
      throw new Error(`payload ${f.path} is not the bytes the manifest pins`)
    }
    mkdirSync(dirname(join(target, f.path)), { recursive: true })
    writeFileSync(join(target, f.path), bytes)
  }
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify({ files }, null, 2)}\n`)
  writeFileSync(
    join(target, 'THIRD_PARTY.md'),
    payloadNotices(readFileSync(join(root, 'THIRD_PARTY.md'), 'utf8'))
  )
  return files
}

export function writeBundle({
  root,
  out,
  sha,
  builtAt = new Date().toISOString(),
  payloads,
  manifest
}) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const contract = JSON.parse(readFileSync(join(root, 'test/device/bundle.json'), 'utf8')).contract
  const info = buildInfo({ sha, version, builtAt, bundleContract: contract })
  const text = `${JSON.stringify(info, null, 2)}\n`

  const stage = mkdtempSync(join(tmpdir(), 'device-bundle-'))
  try {
    // The helpers' own tests run in CI, never on the device, and the fake's
    // sources travel only as the one file built from them.
    cpSync(join(root, 'test/device'), stage, {
      recursive: true,
      filter: (source) =>
        !/^(test_.*\.py|__pycache__)$/.test(basename(source)) &&
        !(basename(dirname(source)) === 'fake-romm' && source.endsWith('.ts'))
    })
    buildFakeRomm({ root, to: join(stage, FAKE_ROMM), notices: join(stage, FAKE_ROMM_NOTICES) })
    for (const name of BRIDGE_FILES) {
      cpSync(join(root, 'tools/device-bridge', name), join(stage, 'bridge', name), {
        recursive: true
      })
    }
    if (payloads !== undefined) stagePayloads({ root, from: payloads, stage, manifest })
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
    else if (flag === '--payloads' && value !== undefined) args.payloads = resolve(value)
    else throw new Error(`unknown option ${flag}`)
  }
  const root = resolve(import.meta.dirname, '..')
  const info = writeBundle({
    root,
    out: resolve(args.out),
    sha: args.sha ?? '',
    payloads: args.payloads
  })
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
