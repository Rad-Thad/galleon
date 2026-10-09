import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFindRules,
  addSystems,
  emptyFindRules,
  expandGlob,
  expandHome,
  loadFindRules,
  parseXml,
  findEmulator,
  resolveRuleSet
} from './findrules.ts'

const BUNDLED = join(import.meta.dirname, '..', '..', 'packaging', 'es-de', 'linuxarm')

const scratch = (): string => mkdtempSync(join(tmpdir(), 'galleon-findrules-'))

function touch(path: string, mode = 0o644): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, mode)
}

test('the parser keeps every top-level element, not only the first', () => {
  const forest = parseXml(`<?xml version="1.0"?>
<!-- a comment before the root -->
<ruleList><emulator name="A"/></ruleList>
<emulator name="B"><rule type="staticpath"><entry>/b</entry></rule></emulator>
<ruleList><emulator name="C"/></ruleList>
`)
  assert.deepEqual(
    forest?.map((node) => [node.name, node.attributes.name ?? node.children[0]?.attributes.name]),
    [
      ['ruleList', 'A'],
      ['emulator', 'B'],
      ['ruleList', 'C']
    ]
  )
})

test('the parser decodes entities and CDATA, and reads both quote styles', () => {
  const [root] =
    parseXml(
      `<a x='1 &amp; 2' y="&quot;"><b>&lt;rom&gt; &#65;&#x42;</b><c><![CDATA[<raw> & co]]></c></a>`
    ) ?? []
  assert.deepEqual(root.attributes, { x: '1 & 2', y: '"' })
  assert.equal(root.children[0].text, '<rom> AB')
  assert.equal(root.children[1].text, '<raw> & co')
})

test('the parser refuses what is not well-formed', () => {
  for (const broken of [
    '<a><b></a>',
    '<a>',
    '</a>',
    '<a></a> loose text',
    '<a x=1></a>',
    '<a><!-- never closed </a>',
    '<![CDATA[x]]>'
  ]) {
    assert.equal(parseXml(broken), null, broken)
  }
  assert.deepEqual(parseXml('  \n'), [])
})

test('a custom rule replaces the bundled one by name, whole, and keeps its place', () => {
  const rules = emptyFindRules()
  addFindRules(
    rules,
    `<ruleList>
       <emulator name="ONE"><rule type="systempath"><entry>one</entry></rule>
         <rule type="staticpath"><entry>~/one</entry></rule></emulator>
       <emulator name="TWO"><rule type="systempath"><entry>two</entry></rule></emulator>
       <core name="ONE"><rule type="corepath"><entry>~/cores</entry></rule></core>
     </ruleList>`,
    'bundled'
  )
  // A loose element after the root, as a hand edit leaves it.
  assert.ok(
    addFindRules(
      rules,
      `<ruleList></ruleList>
       <emulator name="ONE"><rule type="staticpath"><entry>~/Applications/One*.AppImage</entry></rule></emulator>
       <emulator name="THREE"><rule type="systempath"><entry>three</entry></rule></emulator>`,
      'custom'
    )
  )

  assert.deepEqual([...rules.emulators.keys()], ['ONE', 'TWO', 'THREE'])
  assert.deepEqual(rules.emulators.get('ONE'), {
    name: 'ONE',
    source: 'custom',
    rules: [{ type: 'staticpath', entries: ['~/Applications/One*.AppImage'] }]
  })
  assert.equal(rules.emulators.get('TWO')?.source, 'bundled')
  // An emulator's override says nothing about the core of the same name.
  assert.equal(rules.cores.get('ONE')?.source, 'bundled')
})

test('a custom system replaces the bundled one by name', () => {
  const rules = emptyFindRules()
  addSystems(
    rules,
    `<systemList>
       <system><name>psx</name><fullname>Sony PlayStation</fullname><path>%ROMPATH%/psx</path>
         <extension>.chd .CHD .m3u</extension>
         <command label="Beetle">%EMULATOR_RETROARCH% %ROM%</command>
         <platform>psx</platform></system>
       <system><name>n64</name><platform>n64, n64dd</platform></system>
     </systemList>`,
    'bundled'
  )
  addSystems(
    rules,
    `<systemList><system><name>psx</name><fullname>PlayStation (Armada)</fullname>
       <command label="Mine">%EMULATOR_MINE% -batch %ROM%</command></system></systemList>`,
    'custom'
  )
  assert.deepEqual([...rules.systems.keys()], ['psx', 'n64'])
  const psx = rules.systems.get('psx')
  assert.equal(psx?.source, 'custom')
  assert.equal(psx?.fullname, 'PlayStation (Armada)')
  assert.deepEqual(psx?.commands, [{ label: 'Mine', command: '%EMULATOR_MINE% -batch %ROM%' }])
  assert.deepEqual(rules.systems.get('n64')?.platforms, ['n64', 'n64dd'])
})

test('rule kinds a Linux machine has no use for, and nameless entries, are left out', () => {
  const rules = emptyFindRules()
  addFindRules(
    rules,
    `<ruleList>
       <emulator name="X"><rule type="winregistrypath"><entry>HKLM</entry></rule>
         <rule type="systempath"><entry> x </entry><entry></entry></rule></emulator>
       <emulator><rule type="systempath"><entry>nameless</entry></rule></emulator>
     </ruleList>`,
    'bundled'
  )
  assert.deepEqual(
    [...rules.emulators.values()],
    [{ name: 'X', source: 'bundled', rules: [{ type: 'systempath', entries: ['x'] }] }]
  )
  assert.equal(addFindRules(rules, '<ruleList>', 'custom'), false)
  assert.equal(addSystems(rules, '<systemList><system></systemList>', 'custom'), false)
})

test('the vendored linuxarm files parse whole', () => {
  const rules = emptyFindRules()
  assert.ok(
    addFindRules(rules, readFileSync(join(BUNDLED, 'es_find_rules.xml'), 'utf8'), 'bundled')
  )
  assert.ok(addSystems(rules, readFileSync(join(BUNDLED, 'es_systems.xml'), 'utf8'), 'bundled'))
  // The counts docs/research/armada_integration.md gives for the pinned commit.
  assert.equal(rules.systems.size, 195)
  assert.ok(rules.emulators.size > 50)
  assert.ok(rules.cores.has('RETROARCH'))
  for (const set of rules.emulators.values()) assert.ok(set.rules.length > 0, set.name)
})

test('loading layers the custom folder on the bundled one and names a broken file', async () => {
  const bundled = scratch()
  const custom = scratch()
  writeFileSync(
    join(bundled, 'es_find_rules.xml'),
    '<ruleList><emulator name="E"><rule type="systempath"><entry>e</entry></rule></emulator></ruleList>'
  )
  writeFileSync(
    join(bundled, 'es_systems.xml'),
    '<systemList><system><name>s</name></system></systemList>'
  )
  writeFileSync(
    join(custom, 'es_find_rules.xml'),
    '<ruleList><emulator name="E"><rule type="staticpath"><entry>/e</entry></rule></emulator></ruleList>'
  )
  writeFileSync(join(custom, 'es_systems.xml'), '<systemList><system><name>s</systemList>')

  const loaded = await loadFindRules(bundled, custom)
  assert.equal(loaded.rules.emulators.get('E')?.source, 'custom')
  // The broken custom systems file costs its own overrides and nothing else.
  assert.equal(loaded.rules.systems.get('s')?.source, 'bundled')
  assert.deepEqual(loaded.unreadable, [join(custom, 'es_systems.xml')])

  // No custom folder at all is the ordinary case off armadaOS.
  const plain = await loadFindRules(bundled, join(custom, 'absent'))
  assert.equal(plain.rules.emulators.get('E')?.source, 'bundled')
  assert.deepEqual(plain.unreadable, [])
})

test('`~` is the home folder only at the start of an entry', () => {
  assert.equal(expandHome('~/Applications/x', '/home/a'), '/home/a/Applications/x')
  assert.equal(expandHome('~', '/home/a'), '/home/a')
  assert.equal(expandHome('/opt/~x', '/home/a'), '/opt/~x')
  assert.equal(expandHome('~other/x', '/home/a'), '~other/x')
})

test('a glob expands `*` in any component, case-sensitively, in name order', async () => {
  const root = scratch()
  touch(join(root, 'apps', 'Emu-1.0.AppImage'))
  touch(join(root, 'apps', 'Emu-2.0.AppImage'))
  touch(join(root, 'apps', 'emu-3.0.AppImage'))
  touch(join(root, 'opt', 'emu-a', 'bin', 'emu'))
  touch(join(root, 'opt', 'emu-b', 'bin', 'emu'))

  assert.deepEqual(await expandGlob(join(root, 'apps', 'Emu*.AppImage')), [
    join(root, 'apps', 'Emu-1.0.AppImage'),
    join(root, 'apps', 'Emu-2.0.AppImage')
  ])
  assert.deepEqual(await expandGlob(join(root, 'opt', 'emu-*', 'bin', 'emu')), [
    join(root, 'opt', 'emu-a', 'bin', 'emu'),
    join(root, 'opt', 'emu-b', 'bin', 'emu')
  ])
  assert.deepEqual(await expandGlob(join(root, 'missing', '*')), [])
  assert.deepEqual(await expandGlob('relative/*'), [])
})

test('resolution takes the first rule and entry that find something, and names it', async () => {
  const home = scratch()
  const bin = join(home, 'bin-on-path')
  touch(join(bin, 'notexec'), 0o644)
  touch(join(home, 'Applications', 'Emu-1.0.AppImage'))
  touch(join(home, 'Applications', 'Emu-2.0.AppImage'))
  mkdirSync(join(home, 'cores'), { recursive: true })
  const ctx = { home, pathVariable: `/nonexistent:${bin}` }

  const set = {
    name: 'EMU',
    source: 'custom' as const,
    rules: [
      { type: 'systempath' as const, entries: ['emu', 'notexec', `${bin}/notexec`] },
      {
        type: 'staticpath' as const,
        entries: ['~/AppImages/Emu*.AppImage', '~/Applications/Emu*.AppImage']
      }
    ]
  }
  assert.deepEqual(await resolveRuleSet(set, ctx), {
    emulator: 'EMU',
    source: 'custom',
    type: 'staticpath',
    entry: '~/Applications/Emu*.AppImage',
    // Of two versions side by side, the later.
    path: join(home, 'Applications', 'Emu-2.0.AppImage')
  })

  // Once it is on PATH and executable, the earlier rule wins.
  touch(join(bin, 'emu'), 0o755)
  assert.equal((await resolveRuleSet(set, ctx))?.path, join(bin, 'emu'))

  // A corepath finds a folder, and a staticpath never does.
  const cores = {
    name: 'C',
    source: 'bundled' as const,
    rules: [{ type: 'corepath' as const, entries: ['~/cores'] }]
  }
  assert.equal((await resolveRuleSet(cores, ctx))?.path, join(home, 'cores'))
  const folder = { ...cores, rules: [{ type: 'staticpath' as const, entries: ['~/cores'] }] }
  assert.equal(await resolveRuleSet(folder, ctx), null)

  assert.equal(await findEmulator(emptyFindRules(), 'EMU', ctx), null)
})
