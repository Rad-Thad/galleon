/**
 * The machine RomMix is running on: where it keeps its files, and what the
 * pre-flight check found.
 */

import type { EmulatorState } from '../../config/emulators/types.ts'

/**
 * What RomMix can ask the machine to do with itself, beyond quitting.
 *
 * For the session where RomMix is the whole of it — a television with no
 * desktop behind it — where the alternative to these is the power button on the
 * case. See `power`.
 */
export type PowerAction = 'suspend' | 'reboot' | 'poweroff'

/** Where RomMix keeps everything it owns. */
export interface RootLocation {
  current: string
  /** What it would be with nothing configured. */
  fallback: string
  /** Set by GALLEON_HOME, which overrides the stored pointer and cannot be changed here. */
  fromEnvironment: boolean
}

/**
 * The room left on one drive games are written to.
 *
 * `path` is a folder on it rather than the mount point: it is what RomMix was
 * asked about and what the user would recognise — "this is where my Switch
 * games go" — where `/run/media/mmcblk0p1` is a fact about the machine.
 */
export interface DriveSpace {
  path: string
  /** Free to the user running RomMix, which is below what is free to root. */
  freeBytes: number
  totalBytes: number
  /** The mounted volume the folder is on, where the mount table names one. */
  volume?: DriveVolume
}

/**
 * The volume behind a drive, as the mount table and udev name it.
 *
 * Shown beside the room left so a library on the SD card can be told from one
 * on internal storage, and a card the emulators cannot use from one they can.
 */
export interface DriveVolume {
  mountPoint: string
  fsType: string
  /** The file system's label, or null for a volume without one. */
  label: string | null
}

/** Result of the pre-flight check shown on the Settings screen. */
export interface DiagnosticsReport {
  /**
   * Whether `flatpak` is on the machine at all.
   *
   * RomMix does not need it for itself, but most of the emulators it drives are
   * distributed that way, and without it they all report themselves missing for
   * a reason nothing else on the screen would explain.
   */
  flatpakAvailable: boolean
  /**
   * Whether Flathub is a remote of the *user* installation, which is the one
   * RomMix installs into.
   *
   * A separate answer from `flatpakAvailable` because it fails separately and
   * far less visibly: Debian, Ubuntu and Arch ship flatpak with no remotes, and
   * Fedora's Flathub is filtered until enabled. On any of those, every emulator
   * reports itself missing while the row above says flatpak is fine. RomMix adds
   * the remote itself on first install; this is what says so before then.
   */
  flathubConfigured: boolean
  emulators: EmulatorState[]
  /** True when every installed emulator's ROM folder can be written to. */
  romsWritable: boolean
  /**
   * The drives those folders are on, one entry each. See `drivesOf`.
   *
   * Empty where nothing could be measured, which is the same thing the screen
   * says about a drive that will not answer: nothing.
   */
  drives: DriveSpace[]
  /**
   * The power profile, governor and clocks in force when the check ran: on
   * the Nova the profile is what decides whether browsing feels smooth.
   */
  power: PowerState
  /** The log file, so a bug report can name the file rather than hunt for it. */
  logPath: string
  notes: string[]
}

/**
 * What the machine's power management is doing, for the performance overlay.
 * See `readPowerState`.
 */
export interface PowerState {
  cpuGovernor: string
  /** Prime-cluster frequencies, in kHz as cpufreq reports them. */
  cpuCurKHz: number | null
  cpuMaxKHz: number | null
  gpuGovernor: string
  /** GPU frequencies, in Hz as devfreq reports them. */
  gpuCurHz: number | null
  gpuMaxHz: number | null
  /**
   * The profile in force: as `armada-power status` names it where the caller
   * asked it, else by its label as the machine's clocks show it. See
   * `readPowerState` and `profileInForce`.
   */
  profile: string
  /**
   * The profile Armada starts in, from its profile definitions: not
   * necessarily the one in force, which Steam may have switched.
   */
  defaultProfile: string
  /** Armada's perf contract as `layer.key=value` entries. See `parsePerfState`. */
  perf: string
}

/** What the performance overlay measures against. See the `system:perfState` handler. */
export interface PerfState {
  /** The display's refresh rate, which decides what counts as a janky frame. */
  displayHz: number
  power: PowerState
}

/** One screen's frame statistics, as the `perf summary` log line records them. */
export interface PerfSummary {
  screen: string
  frames: number
  p50: number
  p90: number
  p99: number
  jankyPct: number
}
