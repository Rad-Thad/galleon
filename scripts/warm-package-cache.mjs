#!/usr/bin/env node
//
// Fetch what `npm run package` would otherwise fetch half-way through, and
// print the path of the Electron archive it is to be handed.
//
// electron-builder downloads two things while it packages: Electron itself,
// and the toolset that turns a folder into an AppImage. Each is a request to
// github.com from inside a step that is never retried, so a runner whose DNS
// hiccups for a second fails the build for a reason that has nothing to do with
// the commit. Here they are fetched before that step, with a few attempts, into
// the caches electron-builder reads; the workflow restores those caches between
// runs, so most runs fetch nothing at all.
//
// A warm cache is not quite enough for Electron. electron-builder's own copy of
// `@electron/get` fetches the checksum list again on every run to check the
// cached archive against it, which is a request to github.com from inside the
// package step all the same. So the archive is checked here, against that same
// list, and its path is handed to the workflow to pass as `electronDist`;
// handed an archive, electron-builder does not go looking for one. The toolset
// needs nothing of the kind: electron-builder carries its checksum, so a cached
// copy is used without asking anybody.
//
// The path is written to the step's outputs as `electron-zip`, when there is a
// step (`GITHUB_OUTPUT`), and is the last line of the output either way. Not
// the only line: electron-builder's own fetcher writes its progress to stdout.
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { downloadArtifact } from '@electron/get'

const require = createRequire(import.meta.url)

const [arch] = process.argv.slice(2)
if (arch !== 'x64' && arch !== 'arm64') {
  console.error('usage: warm-package-cache.mjs <x64|arm64>')
  process.exit(1)
}

/** How many times each fetch is tried, and the wait after each failed try. */
const ATTEMPTS = 3
const BACKOFF_MS = [10_000, 30_000]

/**
 * The Electron that package.json installed, which is the one electron-builder
 * packages: it reads the same file.
 */
const { version } = require('electron/package.json')

/**
 * The toolset version electron-builder.yml asks for. Read with a pattern rather
 * than a YAML parser, which would be a dependency for one line; a file that no
 * longer has the line stops this with a message instead of warming the wrong
 * thing.
 */
const toolset = /^toolsets:\s*\n\s+appimage:\s*(\S+)/m.exec(
  readFileSync('electron-builder.yml', 'utf8')
)?.[1]
if (!toolset) {
  console.error('electron-builder.yml names no `toolsets.appimage`; nothing to warm')
  process.exit(1)
}

// electron-builder's own fetcher for the toolset, so it lands exactly where the
// package step looks for it.
const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux.js')
const { Arch } = require('builder-util')

/** Run `fetch` until it succeeds or the attempts run out. */
async function withAttempts(what, fetch) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch()
    } catch (cause) {
      if (attempt >= ATTEMPTS) throw cause
      const wait = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)
      console.error(`${what}: attempt ${attempt} failed (${cause.message}); trying again`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

const zip = await withAttempts(`Electron ${version} for ${arch}`, () =>
  downloadArtifact({ version, platform: 'linux', arch, artifactName: 'electron' })
)
console.error(`Electron ${version} for ${arch}: ${zip}`)

await withAttempts(`AppImage toolset ${toolset}`, () =>
  getAppImageTools(toolset, arch === 'arm64' ? Arch.arm64 : Arch.x64)
)
console.error(`AppImage toolset ${toolset}: cached`)

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `electron-zip=${zip}\n`)
console.log(zip)
