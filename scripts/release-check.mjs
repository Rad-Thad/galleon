#!/usr/bin/env node
//
// The check `.github/workflows/cut-release.yml` runs before it builds anything:
// the version asked for, package.json's and the CHANGELOG.md section must be
// the same one. A release names its version in all three and in the tag it
// is about to create, and a mismatch found after publishing means deleting a
// release by hand; found here, it costs a red run that tagged nothing.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * A version the release workflow will put in a tag: semver without build
 * metadata, which a tag carries badly and the updater does not compare. A
 * suffix (`1.0.0-rc.1`) is allowed; it is what publishes a pre-release.
 */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/

/**
 * Every reason `version` cannot be released from these files, empty when it
 * can. The changelog heading is matched the way scripts/release-notes.mjs
 * finds it, so a section this accepts is one the release page can be written
 * from.
 */
export function releaseErrors({ version, packageVersion, changelog }) {
  if (!VERSION.test(version)) {
    return [`'${version}' is not a version like 1.2.3 or 1.2.3-rc.1 (no leading v)`]
  }
  const errors = []
  if (packageVersion !== version) {
    errors.push(`package.json says ${packageVersion}, not ${version}`)
  }
  const headings = [...changelog.matchAll(/^## (\S+).*$/gm)].map((heading) => heading[1])
  if (!headings.includes(version)) {
    errors.push(`CHANGELOG.md has no '## ${version}' section`)
  }
  return errors
}

function main([version]) {
  if (!version) {
    console.error('usage: release-check.mjs <version>')
    return 2
  }
  const errors = releaseErrors({
    version,
    packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    changelog: readFileSync('CHANGELOG.md', 'utf8')
  })
  for (const error of errors) console.error(`::error::${error}`)
  if (errors.length === 0) console.log(`${version}: package.json and CHANGELOG.md agree`)
  return errors.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2))
}
