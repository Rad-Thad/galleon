// Holding a request the client sent to the OpenAPI document of the server it
// was sent to: the path and method exist, the query names are ones the
// operation declares, and the body has the shape its schema describes.
//
// A server ignores what it does not recognise, so a misspelt field or a
// parameter a version dropped would otherwise pass every real-server test
// while doing nothing. Deliberately small: the shapes RomM's documents use
// (objects, arrays, scalars, `anyOf`/`oneOf`/`allOf`, `$ref`, enums), not all
// of JSON Schema.

/** The operation a method and path name in the document, with its path template. */
export function operationFor(document, method, pathname) {
  for (const [template, operations] of Object.entries(document.paths ?? {})) {
    const literal = template
      .split(/\{[^}]+\}/)
      .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`^${literal.join('[^/]+')}$`)
    if (!pattern.test(pathname)) continue
    const operation = operations[method.toLowerCase()]
    if (operation) return { template, operation }
  }
  return null
}

function resolve(document, schema) {
  let current = schema
  while (current?.$ref) {
    const path = current.$ref.replace(/^#\//, '').split('/')
    current = path.reduce((node, key) => node?.[key], document)
    if (!current) throw new Error(`unresolvable $ref ${schema.$ref}`)
  }
  return current ?? {}
}

const typeOf = (value) =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : Number.isInteger(value)
        ? 'integer'
        : typeof value

/** What is wrong with `value` against `schema`, as `where: why` lines; empty when nothing is. */
export function problemsWith(document, schema, value, where = 'body') {
  const s = resolve(document, schema)
  if (s.anyOf || s.oneOf) {
    const options = s.anyOf ?? s.oneOf
    const fits = options.some((option) => problemsWith(document, option, value, where).length === 0)
    return fits
      ? []
      : [`${where}: ${JSON.stringify(value)} fits none of its ${options.length} shapes`]
  }
  const problems = []
  for (const part of s.allOf ?? []) problems.push(...problemsWith(document, part, value, where))
  if (s.enum && !s.enum.includes(value)) {
    problems.push(`${where}: ${JSON.stringify(value)} is not one of ${s.enum.join(', ')}`)
  }
  if (s.const !== undefined && s.const !== value) {
    problems.push(`${where}: ${JSON.stringify(value)} is not ${JSON.stringify(s.const)}`)
  }
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type]
    const actual = typeOf(value)
    const fits = types.includes(actual) || (actual === 'integer' && types.includes('number'))
    if (!fits) return [...problems, `${where}: ${actual}, the schema says ${types.join(' or ')}`]
  }
  if (typeOf(value) === 'object') {
    for (const name of s.required ?? []) {
      if (!(name in value)) problems.push(`${where}.${name}: required and missing`)
    }
    for (const [name, field] of Object.entries(value)) {
      const declared = s.properties?.[name]
      if (declared) problems.push(...problemsWith(document, declared, field, `${where}.${name}`))
      else if (s.properties && !s.additionalProperties) {
        problems.push(`${where}.${name}: not in the schema`)
      } else if (typeof s.additionalProperties === 'object') {
        problems.push(...problemsWith(document, s.additionalProperties, field, `${where}.${name}`))
      }
    }
  }
  if (typeOf(value) === 'array' && s.items) {
    value.forEach((item, i) =>
      problems.push(...problemsWith(document, s.items, item, `${where}[${i}]`))
    )
  }
  return problems
}

/**
 * Everything wrong with one request.
 *
 * `body` is what was sent: a JSON string, a `FormData`, a `URLSearchParams`,
 * or nothing. A form is held to its schema by field name only, since what a
 * file field carries is bytes the schema cannot describe.
 */
export function requestProblems(document, { method, url, body }) {
  const { pathname, searchParams } = new URL(url)
  const found = operationFor(document, method, pathname)
  if (!found) return [`${method} ${pathname}: no such operation in RomM ${document.info.version}`]
  const { template, operation } = found
  const name = `${method} ${template}`
  const problems = []

  const query = (operation.parameters ?? []).filter((p) => p.in === 'query')
  for (const key of new Set(searchParams.keys())) {
    if (!query.some((p) => p.name === key)) problems.push(`${name}: query ${key} is not declared`)
  }
  for (const p of query) {
    if (p.required && !searchParams.has(p.name)) {
      problems.push(`${name}: query ${p.name} is required and missing`)
    }
  }

  const content = operation.requestBody?.content ?? {}
  if (body === undefined || body === null) {
    if (operation.requestBody?.required)
      problems.push(`${name}: a body is required and none was sent`)
    return problems
  }
  if (typeof body === 'string') {
    const schema = content['application/json']?.schema
    if (!schema) return [...problems, `${name}: sent JSON, the operation takes none`]
    let value
    try {
      value = JSON.parse(body)
    } catch {
      return [...problems, `${name}: the body is not JSON`]
    }
    return [...problems, ...problemsWith(document, schema, value, name)]
  }
  const form =
    content['multipart/form-data']?.schema ?? content['application/x-www-form-urlencoded']?.schema
  if (!form) return [...problems, `${name}: sent a form, the operation takes none`]
  const s = resolve(document, form)
  const fields = new Set(body.keys())
  for (const field of fields) {
    if (!s.properties?.[field]) problems.push(`${name}: form field ${field} is not in the schema`)
  }
  for (const field of s.required ?? []) {
    if (!fields.has(field)) problems.push(`${name}: form field ${field} is required and missing`)
  }
  return problems
}
