// The shape of lib.mjs, for the TypeScript that tests and uses it.

export interface Profile {
  baseUrl: string
  version: string
}

export interface Credentials {
  username: string
  password: string
}

export type Packet =
  | { kind: 'open'; data: Record<string, unknown> }
  | { kind: 'close' | 'ping' | 'noop' | 'connect' | 'disconnect' }
  | { kind: 'connect_error'; data: unknown }
  | { kind: 'event'; event: string; args: unknown[] }
  | { kind: 'other'; packet: string }

export interface State {
  profile: string
  version: string
  baseUrl: string
  admin: Credentials
  clientToken: string
  deviceId: string
  platforms: string[]
}

export const PROFILES: Record<'v520' | 'v531', Profile>
export const ADMIN: Credentials
export const TOKEN_NAME: string
export const DEVICE_NAME: string
export const TOKEN_SCOPES: string[]

export function splitPackets(body: string): string[]
export function parsePacket(packet: string): Packet
export function eventPacket(event: string, ...args: unknown[]): string
export function mergeCookies(
  jar: Record<string, string>,
  setCookies: readonly string[]
): Record<string, string>
export function cookieHeader(jar: Record<string, string>): string
export function basicAuth(credentials: Credentials): string
export function parseArgs(argv: readonly string[]): { profile: keyof typeof PROFILES }
export function waitForHeartbeat(
  baseUrl: string,
  options?: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch }
): Promise<Response>
export function statePath(profile: string): string
