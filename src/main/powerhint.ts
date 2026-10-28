import type { PowerHint, PowerState } from '@shared/types'
import { UNKNOWN } from './powerstate.ts'

/**
 * Whether to tell the player that Armada's power profile is holding the
 * interface back.
 *
 * On the Nova, Balanced and Eco cap the clocks enough that browsing stutters,
 * and Performance makes it smooth (docs/DEVICE-FACTS.md). The profile state is
 * root-owned and per game, so Galleon only says where the player can change
 * it; nothing here switches it.
 *
 * Shown at most once per change of profile: the profile last read is kept,
 * and the hint is due only when the one read now differs and is a slow one.
 * A profile that cannot be named changes nothing, so a read that fails does
 * not make the next good one look like a change. Off Armada, where there is
 * no profile definition to read, it never shows.
 */

/** Armada's profiles that hold the interface back, by section name. */
export const SLOW_PROFILES = new Set(['balanced', 'eco'])

export interface PowerHintDecision extends PowerHint {
  /** What to keep as the profile last seen. */
  seen: string
}

export function decidePowerHint(
  power: PowerState,
  seen: string,
  dismissed: boolean
): PowerHintDecision {
  const onArmada = power.defaultProfile !== UNKNOWN
  const { profile, profileId } = power
  if (!onArmada || profileId === UNKNOWN || profileId.toLowerCase() === seen.toLowerCase())
    return { show: false, profile, seen }
  return {
    show: !dismissed && SLOW_PROFILES.has(profileId.toLowerCase()),
    profile,
    seen: profileId
  }
}
