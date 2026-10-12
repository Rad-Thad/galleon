import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  archiveIsTheRom,
  chooseLaunchFile,
  fileNameOf,
  discsOf,
  folderOf,
  gameFolderName,
  isLaunchable,
  pathInGame,
  playlistFor
} from './gamefiles.ts'
import type { RommRomFile } from './types/romm.ts'

const file = (name: string, sizeBytes = 1024): { name: string; sizeBytes: number } => ({
  name,
  sizeBytes
})

test('a lone ROM is the launch file', () => {
  assert.equal(
    chooseLaunchFile([file('QuackShot (World) (Rev A).md')]),
    'QuackShot (World) (Rev A).md'
  )
})

test('a cue wins over the much larger bin it references', () => {
  // The failure this prevents: the .bin is bigger by orders of magnitude, so a
  // plain "largest file" rule would pick a headerless track the emulator
  // cannot boot.
  const chosen = chooseLaunchFile([
    file('Final Fantasy VII (Disc 1).bin', 700_000_000),
    file('Final Fantasy VII (Disc 1).cue', 512)
  ])
  assert.equal(chosen, 'Final Fantasy VII (Disc 1).cue')
})

test('a multi-disc playlist wins over the per-disc descriptors', () => {
  const chosen = chooseLaunchFile([
    file('Final Fantasy VII (Disc 1).cue'),
    file('Final Fantasy VII (Disc 2).cue'),
    file('Final Fantasy VII.m3u')
  ])
  assert.equal(chosen, 'Final Fantasy VII.m3u')
})

test('a gdi is recognised for Dreamcast rips', () => {
  const chosen = chooseLaunchFile([
    file('track01.bin', 5_000_000),
    file('track02.raw', 900_000_000),
    file('game.gdi', 400)
  ])
  assert.equal(chosen, 'game.gdi')
})

test('sidecars never win, however large', () => {
  const chosen = chooseLaunchFile([
    file('Sonic.md', 1_048_576),
    file('scans.png', 90_000_000),
    file('readme.txt', 2_000)
  ])
  assert.equal(chosen, 'Sonic.md')
})

test('with no descriptor the largest remaining file is the game', () => {
  const chosen = chooseLaunchFile([
    file('manual.pdf', 5_000),
    file('Chrono Trigger (USA).sfc', 4_194_304)
  ])
  assert.equal(chosen, 'Chrono Trigger (USA).sfc')
})

test('an extensionless file is still a candidate', () => {
  // Some dumps ship the ROM with no extension at all; dropping it would leave
  // nothing to launch.
  assert.equal(chooseLaunchFile([file('DISC')]), 'DISC')
})

test('a dotfile is not mistaken for an extension', () => {
  assert.equal(chooseLaunchFile([file('.hidden', 10), file('game.md', 20)]), 'game.md')
})

test('nothing but sidecars resolves to null rather than a wrong guess', () => {
  assert.equal(chooseLaunchFile([file('readme.txt'), file('cover.jpg')]), null)
})

test('an empty directory resolves to null', () => {
  assert.equal(chooseLaunchFile([]), null)
})

test('a Switch game is the base container, not the playlist beside it', () => {
  // The failure this prevents: RomM ships a multi-file game with an .m3u, and
  // Eden has no loader for one — the launch fails with the game sitting right
  // there in the same folder.
  const chosen = chooseLaunchFile(
    [
      file('Metroid Dread [010093801237C000][v0].nsp', 7_000_000_000),
      file('Metroid Dread [010093801237C800][v393216].nsp', 900_000_000),
      file('Metroid Dread.m3u', 120)
    ],
    'switch'
  )
  assert.equal(chosen, 'Metroid Dread [010093801237C000][v0].nsp')
})

test('an update larger than the game it patches still loses', () => {
  // Size alone would pick the patch, and a patch on its own boots to nothing.
  const chosen = chooseLaunchFile(
    [
      file('Game [0100AAAAAAAAA000].xci', 1_000_000_000),
      file('Game [0100AAAAAAAAA800].nsp', 4_000_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Game [0100AAAAAAAAA000].xci')
})

test('DLC is not the game either', () => {
  const chosen = chooseLaunchFile(
    [
      file('Game [0100AAAAAAAAB001].nsp', 800_000_000),
      file('Game [0100AAAAAAAAA000].nsp', 500_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Game [0100AAAAAAAAA000].nsp')
})

test('a Switch dump named in words rather than title ids is still sorted out', () => {
  const chosen = chooseLaunchFile(
    [
      file('Some Game (Update).nsp', 3_000_000_000),
      file('Some Game [DLC].nsp', 400_000_000),
      file('Some Game.nsp', 2_000_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Some Game.nsp')
})

test('with every Switch container marked an add-on the largest is still launched', () => {
  // Rather than nothing: marks that disqualify everything are marks that were
  // misread, and a Play button that refuses to do anything is worse than one
  // that picks the likeliest file.
  const chosen = chooseLaunchFile(
    [
      file('Game [0100AAAAAAAAA800].nsp', 4_000_000_000),
      file('Game [0100AAAAAAAAB001].nsp', 900_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Game [0100AAAAAAAAA800].nsp')
})

test('a Switch game in no container format falls back to the general rule', () => {
  // Homebrew is a lone .nro, which is neither a container nor a descriptor.
  const chosen = chooseLaunchFile([file('readme.txt'), file('Homebrew.nro', 4_000_000)], 'switch')
  assert.equal(chosen, 'Homebrew.nro')
})

test('the playlist still wins where a playlist means something', () => {
  // The container rule is per system: nothing about the disc systems changes.
  const chosen = chooseLaunchFile(
    [file('Final Fantasy VII (Disc 1).cue'), file('Final Fantasy VII.m3u')],
    'psx'
  )
  assert.equal(chosen, 'Final Fantasy VII.m3u')
})

test('a playlist is not launchable on a container system', () => {
  // What sends an entry recorded before that rule back to disk for an answer.
  assert.equal(isLaunchable('Metroid Dread.m3u', 'switch'), false)
  assert.equal(isLaunchable('Metroid Dread.nsp', 'switch'), true)
  assert.equal(isLaunchable('Final Fantasy VII.m3u', 'psx'), true)
  assert.equal(isLaunchable('Sonic.md'), true)
})

test('an arcade archive is the game rather than something to open', () => {
  // The failure this prevents: a romset unpacked into the chip dumps inside it,
  // which every arcade emulator refuses — the archive is what carries the name
  // of the set.
  assert.equal(archiveIsTheRom('arcade'), true)
  assert.equal(archiveIsTheRom('fbneo'), true)
})

test('an archive on any other system is transport and gets opened', () => {
  assert.equal(archiveIsTheRom('gba'), false)
  // A Neo Geo CD game is a disc image — ES-DE gives that system `.cue` and
  // `.chd` and no archive at all — whatever the Neo Geo beside it is.
  assert.equal(archiveIsTheRom('neogeocd'), false)
  // Triforce is Dolphin and a disc, however arcade the cabinet was.
  assert.equal(archiveIsTheRom('triforce'), false)
})

test('with no system named the archive is transport', () => {
  assert.equal(archiveIsTheRom(), false)
})

test('a path is reduced to the file at the end of it', () => {
  // What the renderer falls back to when RomM has no name for a game, where
  // `node:path` is not available to do it.
  assert.equal(
    fileNameOf('/home/deck/rommix/roms/gba/Advance Wars (Europe).gba'),
    'Advance Wars (Europe).gba'
  )
})

test('a name with no directory in front of it is already the answer', () => {
  assert.equal(fileNameOf('Sonic the Hedgehog (USA).md'), 'Sonic the Hedgehog (USA).md')
})

test('a game directory is named by its own last segment, not by what is in it', () => {
  // Multi-file games are recorded by the folder holding them, and that folder
  // is what the game is called.
  assert.equal(fileNameOf('/home/deck/rommix/roms/psx/Final Fantasy VII'), 'Final Fantasy VII')
})

test('a trailing slash leaves nothing to fall back to, rather than throwing', () => {
  assert.equal(fileNameOf('/home/deck/rommix/roms/psx/'), '')
})

test('a path is reduced to the directory holding it', () => {
  // What the screens name when they say where something is: the folder is what
  // a user can open, the file is what they already pressed.
  assert.equal(
    folderOf('/home/deck/rommix/roms/gba/Advance Wars (Europe).gba'),
    '/home/deck/rommix/roms/gba'
  )
})

test('a name with no directory in front of it has no folder to name', () => {
  assert.equal(folderOf('Sonic the Hedgehog (USA).md'), 'Sonic the Hedgehog (USA).md')
})

test('a file at the root is in the root', () => {
  assert.equal(folderOf('/rommix.AppImage'), '')
})

const romFile = (file_name: string, file_path: string): RommRomFile =>
  ({ file_name, file_path }) as RommRomFile

test("a file keeps the folders below the game's own, and only those", () => {
  const game = { fs_path: 'roms/dc', fs_name: 'Dream Set (USA)' }
  assert.equal(
    pathInGame(game, romFile('track01.bin', 'roms/dc/Dream Set (USA)/Disc 2')),
    'Disc 2/track01.bin'
  )
  assert.equal(pathInGame(game, romFile('a.gdi', 'roms/dc/Dream Set (USA)/')), 'a.gdi')
  // A library mounted under another prefix still finds the game by its folder.
  assert.equal(
    pathInGame(game, romFile('t.bin', 'library/roms/dc/Dream Set (USA)/Disc 1')),
    'Disc 1/t.bin'
  )
  // Nothing to line up with: the leaf, as before.
  assert.equal(pathInGame(game, romFile('t.bin', 'elsewhere/x')), 't.bin')
})

test('discs are the descriptors of each folder, or its images, in number order', () => {
  assert.deepEqual(
    discsOf([
      'Disc 10/disc.gdi',
      'Disc 10/track01.bin',
      'Disc 2/disc.gdi',
      'Disc 2/track01.bin',
      'readme.txt'
    ]),
    ['Disc 2/disc.gdi', 'Disc 10/disc.gdi']
  )
  assert.deepEqual(discsOf(['B (Disc 2).chd', 'B (Disc 1).chd', 'cover.png']), [
    'B (Disc 1).chd',
    'B (Disc 2).chd'
  ])
  // A cue beside its tracks is one disc, whatever the tracks are called.
  assert.deepEqual(discsOf(['A.cue', 'A (Track 1).bin', 'A (Track 2).bin']), ['A.cue'])
})

test('a playlist only for several discs on a system that changes discs by one', () => {
  const two = ['G (Disc 1).iso', 'G (Disc 2).iso']
  assert.equal(playlistFor(two, 'gc'), 'G (Disc 1).iso\nG (Disc 2).iso\n')
  assert.equal(playlistFor(['G (Disc 1).iso'], 'gc'), null)
  assert.equal(playlistFor(two, 'switch'), null)
  assert.equal(playlistFor(two, 'ps2'), null)
})

test('a game folder never carries .m3u in its name', () => {
  assert.equal(gameFolderName('Saga (USA).m3u'), 'Saga (USA)')
  assert.equal(gameFolderName('Saga.M3U (USA)'), 'Saga (USA)')
  assert.equal(gameFolderName('.m3u'), 'game')
  assert.equal(gameFolderName('Saga (USA)'), 'Saga (USA)')
})
