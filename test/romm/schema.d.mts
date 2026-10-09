// The shape of schema.mjs, for the TypeScript that tests and uses it.

export interface OpenApiDocument {
  info: { version: string }
  paths?: Record<string, Record<string, unknown>>
  components?: Record<string, unknown>
}

export interface SentRequest {
  method: string
  url: string
  body?: string | FormData | URLSearchParams | null
}

export function operationFor(
  document: OpenApiDocument,
  method: string,
  pathname: string
): { template: string; operation: Record<string, unknown> } | null
export function problemsWith(
  document: OpenApiDocument,
  schema: unknown,
  value: unknown,
  where?: string
): string[]
export function requestProblems(document: OpenApiDocument, request: SentRequest): string[]
