import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coreForSystem, isKnownSystem } from '../systems.ts'
import { STATE_SYNC, statesSync } from './states.ts'

test('every rule names a known system, once per tag', () => {
  const seen = new Set<string>()
  for (const { system, tag } of STATE_SYNC) {
    assert.ok(isKnownSystem(system), system)
    const key = `${system}:${tag}`
    assert.ok(!seen.has(key), `${key} is listed twice`)
    seen.add(key)
  }
})

test("RetroArch's own core for each listed system is one whose states sync", () => {
  for (const system of new Set(STATE_SYNC.map((rule) => rule.system))) {
    const core = coreForSystem(system)
    assert.ok(core !== null && statesSync(system, core), `${system} runs ${core}`)
  }
})

test('states sync for the cores Argosy runs too, and nowhere else', () => {
  assert.equal(statesSync('snes', 'snes9x'), true)
  assert.equal(statesSync('gba', 'mgba'), true)
  for (const core of ['pcsx_rearmed', 'swanstation', 'mednafen_psx']) {
    assert.equal(statesSync('psx', core), true, core)
  }

  // A standalone's snapshots belong to its build; they stay where they were made.
  assert.equal(statesSync('psx', 'duckstation'), false)
  assert.equal(statesSync('psp', 'ppsspp'), false)
  assert.equal(statesSync('gc', 'dolphin'), false)
  // A system with no rule, and a tag that is a core of another system's.
  assert.equal(statesSync('genesis', 'genesis_plus_gx'), false)
  assert.equal(statesSync('gba', 'snes9x'), false)
  // The fallback tag, which names no core at all.
  assert.equal(statesSync('snes', 'retroarch'), false)
})
