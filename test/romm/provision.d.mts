// The shape of provision.mjs, for the TypeScript that uses it.
import type { PROFILES, State } from './lib.mjs'

export function provision(profile: keyof typeof PROFILES): Promise<State>
