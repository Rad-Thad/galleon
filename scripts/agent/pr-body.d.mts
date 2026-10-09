// The shape of pr-body.mjs, for the TypeScript that tests it.

export function checkBody(
  body: string | undefined,
  author: string | undefined,
  knownIds: ReadonlySet<string>
): string[]
