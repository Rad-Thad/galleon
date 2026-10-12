import type { RommPlatform, RommRom, RommRomPage, RomQuery } from '@shared/types'

/**
 * A platform the self-test can scroll when the library has none large enough.
 *
 * `grid.scroll` measures the grid at the size a real library reaches, and the
 * owner's may have no platform that big. These games exist only in this
 * process: they are never asked of the server and carry no artwork, so the
 * grid draws them from what it holds and nothing about them leaves the device.
 * Offered only once the scroll asks for it (see `RommClient.offerSynthetic`).
 */

/** As many games as the catalogue's 1,000+ grid, with room past the first rows of a page. */
export const SYNTHETIC_GAMES = 1300

/**
 * Below zero, where RomM's own ids never are, so a synthetic game or platform
 * can never be mistaken for one of the server's.
 */
export const SYNTHETIC_PLATFORM_ID = -1
const FIRST_ROM_ID = -1_000_000

const SLUG = 'galleon-synthetic'

/** Matches the page size RomM uses when a query names none. See `RommClient.roms`. */
const DEFAULT_LIMIT = 60

export function syntheticPlatform(): RommPlatform {
  return {
    id: SYNTHETIC_PLATFORM_ID,
    slug: SLUG,
    fs_slug: SLUG,
    name: 'Self-test',
    display_name: 'Self-test',
    custom_name: null,
    rom_count: SYNTHETIC_GAMES,
    fs_size_bytes: 0,
    url_logo: null,
    missing_from_fs: false
  }
}

/** Is this one of the synthetic games' ids? */
export function isSyntheticRom(id: number): boolean {
  return id <= FIRST_ROM_ID && id > FIRST_ROM_ID - SYNTHETIC_GAMES
}

/** The synthetic game with this id, or null for any other id. */
export function syntheticRom(id: number): RommRom | null {
  return isSyntheticRom(id) ? game(FIRST_ROM_ID - id) : null
}

/**
 * The page of synthetic games a query asks for, or null when the query is not
 * for the synthetic platform alone: anything else is the server's to answer.
 */
export function syntheticPage(query: RomQuery): RommRomPage | null {
  if (query.platform_ids?.length !== 1 || query.platform_ids[0] !== SYNTHETIC_PLATFORM_ID) {
    return null
  }
  // Only the filters that can narrow a platform's games. A collection,
  // favourites or the recently played hold none of them.
  if (
    query.collection_id != null ||
    query.virtual_collection_id != null ||
    query.favorite ||
    query.last_played
  ) {
    return { items: [], total: 0, limit: query.limit ?? DEFAULT_LIMIT, offset: query.offset ?? 0 }
  }
  const term = query.search_term?.trim().toLowerCase() ?? ''
  const all = Array.from({ length: SYNTHETIC_GAMES }, (_, index) => index).filter(
    (index) => term === '' || nameOf(index).toLowerCase().includes(term)
  )
  // Names are zero-padded, so their order by name is their order by index.
  if (query.order_dir === 'desc') all.reverse()
  const limit = query.limit ?? DEFAULT_LIMIT
  const offset = query.offset ?? 0
  return {
    items: all.slice(offset, offset + limit).map(game),
    total: all.length,
    limit,
    offset
  }
}

function nameOf(index: number): string {
  return `Self-test ${String(index + 1).padStart(4, '0')}`
}

function game(index: number): RommRom {
  const id = FIRST_ROM_ID - index
  const name = nameOf(index)
  const file = `self-test-${String(index + 1).padStart(4, '0')}`
  return {
    id,
    name,
    slug: file,
    summary: null,
    platform_id: SYNTHETIC_PLATFORM_ID,
    platform_slug: SLUG,
    platform_fs_slug: SLUG,
    platform_display_name: 'Self-test',
    fs_name: `${file}.bin`,
    fs_name_no_ext: file,
    fs_name_no_tags: file,
    fs_extension: 'bin',
    fs_path: SLUG,
    fs_size_bytes: 0,
    path_cover_small: null,
    path_cover_large: null,
    url_cover: null,
    path_video: null,
    has_manual: false,
    path_manual: null,
    url_manual: null,
    regions: [],
    languages: [],
    tags: [],
    revision: null,
    crc_hash: null,
    md5_hash: null,
    sha1_hash: null,
    has_simple_single_file: true,
    has_nested_single_file: false,
    has_multiple_files: false,
    missing_from_fs: false,
    metadatum: {
      genres: [],
      franchises: [],
      companies: [],
      game_modes: [],
      age_ratings: [],
      player_count: '1',
      first_release_date: null,
      average_rating: null
    },
    hltb_metadata: null,
    ra_id: null,
    merged_ra_metadata: null,
    rom_user: {
      id,
      rom_id: id,
      last_played: null,
      now_playing: false,
      backlogged: false,
      hidden: false,
      rating: 0,
      difficulty: 0,
      completion: 0,
      status: null
    },
    files: [],
    merged_screenshots: [],
    sibling_roms: [],
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00'
  }
}
