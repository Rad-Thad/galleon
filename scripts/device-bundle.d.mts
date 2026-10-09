// The shape of device-bundle.mjs, for the TypeScript that tests it.

export interface BuildInfo {
  sha: string
  version: string
  builtAt: string
  bundleContract: number
}

export const BUNDLE_NAME: string
export const BUILD_INFO_NAME: string
export const BRIDGE_FILES: readonly string[]
export function buildInfo(fields: BuildInfo): BuildInfo
export function writeBundle(options: {
  root: string
  out: string
  sha: string
  builtAt?: string
}): BuildInfo
