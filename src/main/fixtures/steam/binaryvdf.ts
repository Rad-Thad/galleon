/** Shortcut lists for tests, built the way Steam writes them. */

/** A fixed field other than an int32 is its raw bytes: four for a colour, eight for a uint64. */
export type Field = string | number | Uint8Array | { [key: string]: Field }

/** Binary VDF as Steam writes it: a map's fields, then its end byte. */
export function binaryVdf(fields: Record<string, Field>): Uint8Array {
  const out: number[] = []
  const text = (s: string): void => {
    out.push(...new TextEncoder().encode(s), 0)
  }
  const map = (object: Record<string, Field>): void => {
    for (const [name, value] of Object.entries(object)) {
      if (typeof value === 'string') {
        out.push(0x01)
        text(name)
        text(value)
      } else if (typeof value === 'number') {
        out.push(0x02)
        text(name)
        const word = new Uint8Array(4)
        new DataView(word.buffer).setInt32(0, value, true)
        out.push(...word)
      } else if (value instanceof Uint8Array) {
        out.push(value.length === 8 ? 0x07 : 0x06)
        text(name)
        out.push(...value)
      } else {
        out.push(0x00)
        text(name)
        map(value)
      }
    }
    out.push(0x08)
  }
  map(fields)
  return Uint8Array.from(out)
}

/** A shortcut as Steam's client adds one; its appid is stored signed. */
export function shortcut(appid: number, name: string, caseOf: 'AppName' | 'appname' = 'AppName') {
  return {
    appid: appid | 0,
    [caseOf]: name,
    Exe: `"/home/deck/${name}.sh"`,
    StartDir: '"/home/deck/"',
    icon: '',
    LaunchOptions: '',
    IsHidden: 0,
    LastPlayTime: 1761600000,
    FlatpakAppID: '',
    tags: { '0': 'favourite' }
  }
}
