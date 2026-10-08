# Argosy fork design spec (extract)

This is the design section of the tester's private Android Argosy fork (`~/Documents/argosy-fork/CLAUDE.md`, lines 47-238, as of 2026-09-15), copied so the cloud agent can build the same look on Linux. It is a description of a design, not code; nothing here is GPL source. Android-specific names (Compose files, `csp()`, `ForkLauncherTheme`, LibretroDroid) describe how the fork did it and are not instructions for this Electron app.

How to read it for this project:

- The canvas is **1024 x 768**; the Nova's panel is **1280 x 960**, so canvas pixels scale by **1.25** (type additionally follows TEXT SIZE, default 1.2x).
- "Upstream" in the text means upstream Argosy. Here the inherited code is RomMix.
- "Built-in emulator" and the in-game bar refer to Argosy's libretro frontend; on Linux the emulators are separate programs, so the in-game bar becomes a Quick Access panel (see docs/PLAN.md, M3).
- Owner decisions are dated; later decisions override earlier ones. The tester has since asked for CRT shaders on modern systems too, which overrides the 'none for GameCube, Dreamcast and PSP' choice below (docs/REQUIREMENTS-FROM-TESTER.md, #12).

---

## The design

The fork's design canvas (three boards: Now playing, Browse, File state) is private; the essentials below are the spec.

### Canvas and palette

- **1024 × 768** — the Retroid Pocket Nova's 4:3 screen. Box art is framed **4:3** everywhere.
- Background `#000000`, text `#ffffff`, then `#d6d6d6` / `#9a9a9a` / `#6e6e6e` / `#4a4a4a`.
- Hairlines and borders `#1c1c1c`.
- **One accent**, default `#e0a24b`, user-swappable (Settings → ACCENT; six choices, plus a BLACK / CHARCOAL ground). The accent is reserved for things **in
  motion** — a download in progress, the current selection. Nothing else may use it. This is a
  rule, not a preference: it is what makes status readable at a glance.
- **One mono family** throughout. The canvas uses IBM Plex Mono. Android does not bundle it —
  ship it as an app font asset, or substitute a mono with similar metrics. Hierarchy comes from
  weight and letter-spacing, not size jumps. **Weights below are one step above the canvas** (500
  where it says 400, 700 where it says 600): the canvas weights rendered thin on the Nova's panel.
  **All type renders 1.2× the canvas size by default** (TEXT SIZE in Settings, 100–130 %, applied
  in `csp()`; owner request 2026-09-12); lengths stay at canvas scale, and the Browse bar grew from
  140 to 156 px to fit.

### Type

| Use | Size | Weight | Tracking |
|---|---|---|---|
| Screen title (PLAYSTATION) | 13 | 700 | 0.16em |
| Game title | 18–19 | 700 | -0.005em |
| Metadata label (DEVELOPER) | 10 | 500 | 0.12em |
| Metadata value | 11.5 | 500 | normal |
| Tile label | 10–10.5 | 500 | 0.04em |
| Status label | 10.5 | 500 | 0.12em |

### Tile art — title-aware crop and selection reveal (decided 2026-09-11)

Box art stays a **full-bleed 4:3 crop**, but the crop window slides to keep the title: the app
matches the game's logo file (RomM `roms/{platform}/{rom}/logo/logo.png`, 422 of 432 games) against
the cover once per game, in the background, and stores one number per game (0 = top … 1 = bottom).
When the match is not confident, or there is no logo, the crop stays centred — a wrong move is
worse than centre. Prototype on 28 covers: 17 fixed, 5 already fine, 6 still cut, 0 made worse.

**The selected tile opens to the whole cover.** Selection is the gamepad's hover. The cover zooms
out inside the frame (~320 ms, ease-out-cubic) until it is entirely visible, and the blurred,
dimmed cover fades in behind to keep the tile full-bleed. The tile never changes size or position.
Leaving the selection plays the motion in reverse. Canvas boards: **Tile art** (rejected options),
**Title-aware crop**, **Selection reveal** (option A chosen).

### File state — the core mechanic

One dot, bottom-left of the art. Hollow means the file is only on the server; filled means it is
spoken for. **The progress hairline appears only once bytes are moving** — nothing may imply
progress that has not happened.

| State | Dot | Bar |
|---|---|---|
| On server | hollow ring, `#4a4a4a` border | none |
| Queued | solid `#6e6e6e` | none |
| Downloading | solid accent | 2px hairline, accent, fills L→R |
| Installed | solid `#ffffff` | none |

### Screens

**Now playing** — split view. Left column 424px: two-column feed of 4:3 tiles. Right: preview
video (4:3) above a metadata block — title, year, developer, publisher, genre, file (disc count
and size). Status and progress on a row beneath a hairline rule.

**Browse** — dense 5-column grid of 4:3 tiles, metadata pinned to a **140px bar along the bottom**.
The bar's background is the selected game's **preview video, full-bleed**, with a left-to-right
scrim over it: solid `#000` to 50%, `rgba(0,0,0,0.82)` at 66%, `rgba(0,0,0,0.30)` at 80%,
transparent by 92%. All text lives left of the fade; the right third is uncovered video.
**Owner additions (2026-09-10):**
- A third metadata row — PLAYED, TO BEAT, ACHIEVEMENTS — beneath DEVELOPER / PUBLISHER / GENRE;
  TRANSFER joins that third row while downloading.
- The video occupies the **right half** of the bar, not the full width (the left half is under solid
  scrim anyway; a full-width 4:3 video showed only a fifth of its height).
- **The bar rises into a panel on A.** The bar and the panel are one element at two heights (140 →
  416). The text already in the bar travels up with it; the video slot grows from the band to its
  whole frame (512 × 384, letterboxed on black if not 4:3) and the scrim fades out; box art (4:3),
  the description and the action hints (A PLAY / DOWNLOAD, X DETAILS, B CLOSE) fade in beneath the
  metadata. The grid dims but never moves. B (or tapping the panel) drops it back. Play goes
  through upstream's launch delegate and shows upstream's own sync overlay and disc prompts.

**Now playing — implementation decisions (2026-09-11):** the left feed is the **recently played**
list (up to 12, most recent first; empty state points at Browse). The right side is the selected
game's video, letterboxed whole in a 4:3 frame, over title / year, DEVELOPER / PUBLISHER / GENRE /
FILE, a hairline, and the status row with the transfer bar and "34% · 412 MB / 1.2 GB" while
downloading. Controls: A play / download, X upstream detail, **Y toggles preview audio** (a fork
setting, honoured by Browse too; the header and the badge on the video show PREVIEW AUDIO / MUTED),
**RB opens Browse**, B back. Since Task 5 it is the home screen (mounted on upstream's Home route).

**Menus (decided 2026-09-11, canvas page "Menus"):** the fork replaces every remaining surface.
Now playing is the home screen (mounted on upstream's Home route). The **drawer** (Start) lists
Now playing, Browse, Downloads, Saves, Apps, Settings, with counts only when something needs
attention. **Settings, Downloads and Saves are fork layouts over upstream's ViewModels (2026-09-13):** the settings hub lists the fork's knobs (ACCENT, GROUND, TEXT SIZE, SCREENSAVER AFTER, SCREENSAVER FIELD, PREVIEW AUDIO; left / right change them in place) and then upstream's sections, each of which opens upstream's own screen unchanged. Upstream's Theme section is left out of the hub: the fork theme overrides everything it controls. **Game details** keeps upstream's
logic and pop-ups under a fork layout: the plain cover in a white hairline, status, action rail on the left;
metadata, description, screenshots, achievements, related on the right. The **in-game menu** (built-in
emulator only, Start + Select) is a **bar along the bottom** of the dimmed game (owner request,
2026-09-12; it began as a left panel): title and core on the left; PLAYED, SESSION clock and
ACHIEVEMENTS on the right; the latest unlocks with badges on a second line; then one horizontal row
of upstream's actions (left / right, A, B; up on QUICK LOAD for its history). The owner uses the
built-in emulators.

**Owner additions (2026-09-12):** the Browse panel's art is the **plain cover at its own
proportions, filling the panel's height, in a white hairline** — no blur frame (the blurred frame
stays only on the selected grid tile). The detail screen draws the same cover centred in its
376 × 282 area, so the flight lands unchanged.
**Opening details from the panel is a flight** — the rest of Browse fades to black while the cover
glides to the frame the detail screen draws it in, then the route changes. The app-root guide bar
that upstream screens (Settings, Downloads, Saves) show along the bottom is drawn in fork style
(`ForkFooterHost`), same hide rule and height. Achievements come only from RomM's per-game
`ra_metadata`; if RomM has not matched a game to RetroAchievements, the app has nothing to show.

**Screensaver (decided 2026-09-12, canvas page "Screensaver", board "Screensaver · final"):**
after 2.5 idle minutes by default (SCREENSAVER AFTER in Settings: off, 1, 2, 2.5, 3, 5 or 10) the app fades to a
black screen with a soft simplex-noise field in the accent (AGSL shader), the clock top left, a
random game bottom left (cover in a white hairline, platform · year, title, time to beat, A OPEN)
and, top right, level with the top of the clock's digits (owner request 2026-09-13; placed on the digits' ink, not the text box, and follows TEXT SIZE), a 4:3 block (552 × 412 canvas px, 8 × 6 cells of 62 px, 8 px gutters) of that
game's screenshots plus one random page of its manual, snapped to one of three grid patterns.
Every picture is used once; slots the game has no picture for are empty white hairline frames
with a drop shadow. Pictures fill their slot and crop, never letterbox. A new game every 30 s
(the next one is prepared while the current shows). Any button wakes; A opens the game's
details. The saver shares upstream's screen-dimmer activity clock and holds the dimmer off while
it runs. Manuals are RomM's scanned PDFs, fetched once per game into the app cache.

**Upstream screens in the fork look (2026-09-13):** everything the fork still borrows from upstream
(settings sections, pop-ups, the setup wizard, the built-in emulator's in-game settings, shaders,
cheats and achievement list) is restyled by a theme override, not rewritten: `ForkLauncherTheme`
replaces `ALauncherTheme` in both activities and lays the fork ground, white text, hairlines, IBM
Plex Mono (at 80 % of upstream's size, following TEXT SIZE) and square corners over upstream's theme (Material shapes and upstream's three larger radius tokens; its three small radius tokens stay rounded because upstream also uses them as spacing, 2026-09-14 review). White is upstream's "primary"; the accent
reaches upstream screens only as the focus colour (known exception: two static labels in upstream's Settings > RomM > Accounts, recorded in FORK-NOTES). Upstream toggles that are on draw a white track with a black knob and turn accent only while focused (a two-line edit in `ui/primitives/Controls.kt`). Upstream layouts, spacing and any hard-coded
colours stay as upstream drew them.
**Notices, quick menu, Apps (2026-09-13, owner request):** pop-up notices are square fork cards
with a 2 px left mark (white info, grey warning, red error; only a running task's hairline uses the
accent). The L3 quick menu is a fork overlay: category labels across the top instead of round orbs,
game rows with the file-state dot below. Apps is a fork layout with apps in 4:3 hairline frames.
All three keep upstream's view models and controls.
**Built-in emulator tuning (2026-09-14, owner request):** GameCube runs Dolphin at 2x internal resolution, 4x
anisotropic filtering and synchronous ubershaders. Two vendored LibretroDroid changes make Dolphin usable: one stops it
running at double speed on the Nova's 120 Hz screen, and an audio bridge runs Dolphin's async audio mode (Argosy's
default for Dolphin is now async) because its push mode drops a third of the audio as crackle. Per-system shaders: SNES CRT Geom (flat), PS1 zFast
CRT, GBA GBA Color plus zFast LCD, none for GameCube, Dreamcast and PSP. Details and the patched shader:
FORK-NOTES.md, "Dolphin tuning and per-system shaders"; `the fork's `device-shaders/` folder (summarised below)`.

**In-game achievements (2026-09-13):** when the in-game bar opens for a game with nothing cached,
it pulls the achievement list from RomM the way the detail page does, so games started straight
from Browse or Now playing show them too, and upstream's Achievements action appears.

**One selection look (2026-09-14, owner request):** only the item the d-pad is on uses the accent.
Its label turns accent and it carries one accent mark, 2 px thick: a left bar on list rows, an
underline on items in a horizontal line (quick-menu categories, in-game actions, save-conflict
choices, the drawer's account name), a ring inside the hairline frame on tiles, screenshots and
app tiles. Full-width rows (drawer, settings, Downloads, Saves, quick-menu games) also get a faint
accent band behind them (15 %), and so do app tiles (30 % for an app being moved). **Where A does
nothing the label never turns accent**; it only steps one grey brighter, while the mark and band
still show where the focus is, so accent text means "A acts here". A pane that has lost the focus
shows its remembered item white with a grey mark. Colour only, ~120 ms ease-out-cubic; nothing
moves or changes size. The shared pieces are in `ForkFocus.kt`; leftovers in FORK-NOTES.md,
"One selection look".

**Filters and series (owner decisions 2026-09-14 evening; built and verified on the emulator and on the Nova 2026-09-14 ~23:45; Series fills in under a second with the full library, 278 IPs):** Browse gets a **genre filter** (one
genre at a time, cycled ALL → ADVENTURE → PLATFORM → …, from IGDB's 22 genres) and an **ALL / ON DEVICE toggle**
(installed games only); both apply to Browse and the new Series screen, never to Now playing, and are remembered
between launches. A **series / IP feature** lives in two places: a new **SERIES** screen in the drawer listing every
series that spans the library, grouped **series inside IP** (IGDB franchises such as Marvel or Mega Man on top, IGDB
collections such as Mega Man X inside), opening to its games grouped by platform; and a **more in this series** row on
each game's detail page with the other games across platforms. Data (RomM, 2026-09-14): IGDB franchises on ~40-55 %
of games, collections ~50-75 %; 203 franchises and 216 collections span 2+ platforms. **Draft boards (2026-09-14):** canvas
page "Filters & series" (on the fork's design canvas, not public): a 34 px genre strip under
the Browse header (LT/RT step genres ordered by count, SELECT flips ALL / ON DEVICE = installed only, no accent), a SERIES
screen (IPs left, most games first; series right, each game under its tightest collection, grouped by system), and MORE IN
<series> replacing RELATED on details. Owner approved the boards ("love it, build it out"); built as designed. The Series header counts IPs in the whole library (filters never change it); drawer focus opens on NOW PLAYING, so SERIES is two rows down. Build notes from research: Browse has LT,
RT, Select free; `GameListItem` lacks `genres`, `franchises`, `collections`; multi-disc installs can have null `localPath`
(use `isDownloaded || m3uPath != null` like Now playing); upstream related-games SQL uses substring LIKE, so match whole
comma tokens; 9 franchise/collection names contain commas and split wrongly in Argosy's comma-joined columns.

**File state** — a legend board, not a screen. Reference only.

### Motion

- Selection border and label colour: ~120 ms, ease-out-cubic.
- Metadata crossfade on selection change: ~90 ms. **Required on Browse** — snapping text against a
  moving video backdrop reads as a glitch.
- Progress hairline width: ~300 ms linear.
- **The video cuts. It never fades.** A fade delays the audio, which is the point of the feature.
- Animate colour, opacity and width only. Never animate tile size or position — that reflows the
  grid on every d-pad press and will stutter on the handheld.

### Audio

Sound comes **only** from the selected game's preview video. There is deliberately **no separate
soundtrack layer** — this was considered and rejected. Argosy's existing "audio file while
navigating" setting is not this feature and should not be confused with it.

---

## Target device rules (same source, lines 453-463)



Retroid Pocket Nova — Android, **4:3 screen**, gamepad-first. Consequences:

- Every control is reachable by d-pad. Focus order is a feature, not an afterthought; nothing may
  be mouse- or touch-only.
- Hit targets ≥ 44px.
- **No fake chrome.** Never draw a status bar, clock, battery or keyboard — the real ones render on
  top and a painted copy looks doubled.
- Test on the device early. Desktop-smooth does not mean handheld-smooth.

## Prior shader work (`device-shaders/`, summarised)

- `crt-geom.glsl`, `zfast_crt.glsl`, `zfast_lcd.glsl`: unmodified from libretro's `glsl-shaders` (crt/shaders, handheld/shaders).
- `gba-color.glsl`: a patched copy of `handheld/shaders/color/gba-color.glsl`. Its top parameter block declared `uniform COMPAT_PRECISION float darken_screen;`, which Argosy's GLSL parser placed before the fragment shader's precision statement, so the whole chain silently fell back to no shader; the copy replaced it with `#define darken_screen 1.0`. On Linux, RetroArch's own slang shaders do not have this problem; the lesson is to surface shader compile errors instead of failing silently (docs/features.json M7-11).
- Applied on Android (2026-09-14): SNES `crt-geom` with CURVATURE=0; PS1 `zfast_crt`; GBA `gba-color` then `zfast_lcd`; no shader for GameCube/Wii, Dreamcast and PSP. The SNES and GBA chains were never seen on the device itself.
