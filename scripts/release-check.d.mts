// The shape of release-check.mjs, for the TypeScript that tests it.

export function releaseErrors(fields: {
  version: string
  packageVersion: string
  changelog: string
}): string[]
