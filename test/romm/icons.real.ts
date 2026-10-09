/**
 * Platform icons as the image protocol asks for them, against a provisioned
 * Docker RomM: every platform in the fixture library either answers with an
 * icon or falls back to its short code, and no icon the server lacks is asked
 * for twice in one session.
 *
 *   ROMM_PROFILE=v520 npm run test:romm-real
 *
 * Read-only: icons are static files.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLATFORM_ICON_PATHS, resolveSystem, systemInfo } from '../../src/config/systems.ts'
import { client, watch } from './server.ts'

/**
 * The candidate paths for one platform, in the order `PlatformIcon` walks them:
 * RomM's slug, then the system table's icon, each under every icon path.
 */
function candidates(slug: string, system: string | null): string[] {
  const names = [...new Set([slug, system ? systemInfo(system).icon : undefined].filter(Boolean))]
  return names.flatMap((name) =>
    PLATFORM_ICON_PATHS.map((path) => path.replace('{name}', name as string))
  )
}

test('every platform has an icon or a short code, and each 404 is asked once a session', async () => {
  const romm = client()
  const platforms = await romm.platforms()
  assert.ok(platforms.length > 0)

  const sent = watch()
  const missed = new Set<string>()
  // Twice over, as a second screen of the same platforms would ask.
  for (const pass of [1, 2]) {
    for (const platform of platforms) {
      const system = resolveSystem(platform.slug, platform.fs_slug)
      let found: string | null = null
      for (const path of candidates(platform.slug, system)) {
        const response = await romm.asset(path)
        await response.body?.cancel()
        if (response.ok) {
          found = path
          break
        }
        assert.equal(response.status, 404, `${path} answered ${response.status}`)
        missed.add(path)
      }
      const short = systemInfo(system ?? platform.slug).short
      if (!found)
        assert.ok(short.length > 0, `${platform.slug} has neither an icon nor a short code`)
      if (pass === 1) console.log(`${platform.slug}: ${found ?? `fallback ${short}`}`)
    }
  }

  for (const path of missed) {
    const times = sent.filter((request) => new URL(request.url).pathname === path).length
    assert.equal(times, 1, `${path} is a 404 the server was asked ${times} times`)
  }
})
