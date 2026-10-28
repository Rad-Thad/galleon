#!/usr/bin/env bash
#
# Installs or updates Galleon for the current user, from Desktop Mode:
#
#   curl -fsSL https://raw.githubusercontent.com/Rad-Thad/galleon/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Rad-Thad/galleon/main/install.sh | bash -s -- --nightly
#
# The AppImage and galleon-steam.sh go into ~/Applications, held to the
# release's SHA256SUMS, and a desktop entry aimed at the script goes into
# ~/.local/share/applications, which is the list Steam's "Add a Non-Steam Game"
# dialog offers. That dialog's Browse button never opens its file picker under
# KDE on the Nova (docs/DEVICE-FACTS.md), so the steps printed at the end tick
# the entry in the list instead. Running it again updates in place.
#
# Needs bash, curl and coreutils and nothing else, never asks for root, and
# writes nowhere but those two folders: even its downloads are staged inside
# ~/Applications, so a failed run leaves the installed copy as it was.

set -euo pipefail

RELEASES=${GALLEON_RELEASES_URL:-https://github.com/Rad-Thad/galleon/releases}
APP_ID=io.github.Rad-Thad.Galleon
STEAM_SCRIPT=galleon-steam.sh

# packaging/icon.svg, carried inside the script so the icon needs no download
# of its own and no checksum of its own. test/install/install.test.ts holds the
# two to the same bytes.
ICON_SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <!--
    RomMix: a ROM cartridge whose label is a cassette — "Rom" + "Mix" drawn
    rather than spelled. Colours are the app'\''s own (styles.css): #0b0d13 ground,
    #7ad6ff → #2aa9e0 accent.

    Everything sits inside a 22px inset so the shape survives the rounded and
    circular icon masks different shells apply. Strokes are kept at 4px or
    heavier, which is one device pixel at the 32px tray size.
  -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2433"/>
      <stop offset="1" stop-color="#0b0d13"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#7ad6ff"/>
      <stop offset="1" stop-color="#2aa9e0"/>
    </linearGradient>
  </defs>

  <rect width="128" height="128" rx="28" fill="url(#bg)"/>

  <!-- Connector tab and its contacts, drawn first so the body overlaps it -->
  <rect x="40" y="82" width="48" height="24" rx="6" fill="#1f7fae"/>
  <g fill="#0b0d13" opacity="0.55">
    <rect x="48" y="94" width="6" height="10" rx="2"/>
    <rect x="61" y="94" width="6" height="10" rx="2"/>
    <rect x="74" y="94" width="6" height="10" rx="2"/>
  </g>

  <!-- Cartridge body -->
  <rect x="22" y="22" width="84" height="68" rx="11" fill="url(#accent)"/>

  <!-- Label window, cut as a cassette -->
  <rect x="32" y="32" width="64" height="38" rx="7" fill="#0b0d13"/>
  <rect x="50" y="48.5" width="28" height="5" fill="#7ad6ff" opacity="0.4"/>
  <g fill="none" stroke="#7ad6ff" stroke-width="4">
    <circle cx="50" cy="51" r="9"/>
    <circle cx="78" cy="51" r="9"/>
  </g>
  <circle cx="50" cy="51" r="2.5" fill="#7ad6ff"/>
  <circle cx="78" cy="51" r="2.5" fill="#7ad6ff"/>

  <!-- Grip ridge -->
  <rect x="36" y="76" width="56" height="4" rx="2" fill="#0b0d13" opacity="0.5"/>
</svg>'

say() { printf '%s\n' "$*"; }
die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: install.sh [--stable | --nightly] [--arch aarch64|x86_64] [--add-to-steam]

  --stable        the newest release (the default)
  --nightly       the newest build of main, as the test handheld runs it
  --arch ARCH     which build to fetch; required on anything but aarch64
  --add-to-steam  then put Galleon in Steam's library; Steam must be closed
USAGE
}

# A desktop entry's Exec value: the path in double quotes, with what the
# specification reserves inside quotes escaped, and every backslash doubled
# once more because the value is also a string.
desktop_exec() {
  local path=$1 quoted='' char i
  for ((i = 0; i < ${#path}; i++)); do
    char=${path:i:1}
    case $char in
      '"' | '`' | '$') quoted+="\\\\$char" ;;
      \\) quoted+="\\\\\\\\" ;;
      '%') quoted+='%%' ;;
      *) quoted+=$char ;;
    esac
  done
  printf '"%s"' "$quoted"
}

# A plain string value: only backslashes are escaped.
desktop_string() {
  printf '%s' "${1//\\/\\\\}"
}

# The sum SHA256SUMS gives for one file name, or nothing.
listed_sum() {
  local want=$1 sum name
  while read -r sum name; do
    [ "${name#\*}" = "$want" ] && {
      printf '%s' "$sum"
      return 0
    }
  done <"$staging/SHA256SUMS"
  return 0
}

verify() {
  local file=$1 want got
  want=$(listed_sum "$file")
  [ -n "$want" ] || die "$file is not listed in the release's SHA256SUMS; nothing was installed."
  # From standard input: given a path holding a backslash, sha256sum escapes
  # its output line and the sum no longer starts it.
  got=$(sha256sum <"$staging/$file")
  got=${got%% *}
  [ "$got" = "$want" ] || die "$file does not match its checksum; nothing was installed."
}

fetch() {
  local name=$1
  curl --fail --silent --show-error --location --retry 2 \
    --output "$staging/$name" "$base/$name" ||
    die "could not download $name from $base; nothing was installed."
}

main() {
  local channel=stable arch='' machine add_to_steam=''
  while [ $# -gt 0 ]; do
    case $1 in
      --stable) channel=stable ;;
      --nightly) channel=nightly ;;
      --add-to-steam) add_to_steam=1 ;;
      --arch)
        [ $# -ge 2 ] || die '--arch needs aarch64 or x86_64.'
        arch=$2
        shift
        ;;
      --arch=*) arch=${1#--arch=} ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        usage >&2
        die "unknown option: $1"
        ;;
    esac
    shift
  done

  machine=$(uname -m)
  case $arch in
    '' | aarch64 | x86_64) ;;
    *) die "--arch takes aarch64 or x86_64, not $arch." ;;
  esac
  if [ "$machine" != aarch64 ] && [ "$arch" != x86_64 ]; then
    die "this machine is $machine, and Galleon is built for the aarch64 handheld. Pass --arch x86_64 to install the x86_64 build here anyway."
  fi
  arch=${arch:-$machine}

  local image
  case $arch in
    aarch64) image=Galleon-arm64.AppImage ;;
    x86_64) image=Galleon-x86_64.AppImage ;;
  esac

  [ -n "${HOME-}" ] || die 'HOME is not set.'
  case $HOME in
    *$'\n'*) die 'HOME contains a line break, which a desktop entry cannot hold.' ;;
  esac
  local apps=$HOME/Applications
  local menu=$HOME/.local/share/applications

  case $channel in
    stable) base=$RELEASES/latest/download ;;
    nightly) base=$RELEASES/download/nightly ;;
  esac

  mkdir -p -- "$apps" "$menu"
  staging=$(mktemp -d -- "$apps/.galleon-install.XXXXXX")
  trap 'rm -rf -- "$staging"' EXIT

  say "Downloading the $channel $arch build of Galleon..."
  fetch SHA256SUMS
  fetch "$image"
  fetch "$STEAM_SCRIPT"
  verify "$image"
  verify "$STEAM_SCRIPT"

  chmod 0755 -- "$staging/$image" "$staging/$STEAM_SCRIPT"
  printf '%s\n' "$ICON_SVG" >"$staging/$APP_ID.svg"
  {
    say '[Desktop Entry]'
    say 'Type=Application'
    say 'Name=Galleon'
    say 'GenericName=RomM Game Launcher'
    say 'Comment=Browse, download and play your RomM library'
    say "Exec=$(desktop_exec "$apps/$STEAM_SCRIPT")"
    say "Icon=$(desktop_string "$menu/$APP_ID.svg")"
    say 'Terminal=false'
    say 'Categories=Game;'
  } >"$staging/$APP_ID.desktop"
  chmod 0644 -- "$staging/$APP_ID.svg" "$staging/$APP_ID.desktop"

  # Each a rename within one file system, so no file is ever half-written in
  # place; the image first, so the script and the menu entry never point at a
  # folder without one.
  mv -f -- "$staging/$image" "$apps/$image"
  mv -f -- "$staging/$STEAM_SCRIPT" "$apps/$STEAM_SCRIPT"
  mv -f -- "$staging/$APP_ID.svg" "$menu/$APP_ID.svg"
  mv -f -- "$staging/$APP_ID.desktop" "$menu/$APP_ID.desktop"

  say "Installed $apps/$image and $apps/$STEAM_SCRIPT."
  say ''

  # The app writes Steam's binary shortcut list itself: this script has
  # nothing that could. It refuses while Steam runs and says why, and the
  # install above stands either way.
  local steam_status=0
  if [ -n "$add_to_steam" ]; then
    "$apps/$STEAM_SCRIPT" --add-to-steam || steam_status=$?
    [ "$steam_status" -eq 0 ] && return 0
    say ''
    say 'Galleon is installed, but not in Steam yet (see above). To add it by hand:'
  fi
  say 'To start it from Steam, once (an update needs none of this):'
  say '  1. In Desktop Mode, open Steam.'
  say '  2. Games > Add a Non-Steam Game to My Library...'
  say '  3. Tick Galleon in the list. Do not use Browse: its file picker does not open.'
  say '  4. Add Selected Programs.'
  [ -n "$add_to_steam" ] || {
    say ''
    say 'Or, with Steam closed, run this again with --add-to-steam to do it for you.'
  }
  # Installed either way; the status still says the Steam step did not happen.
  return "$steam_status"
}

# Everything above only defines; this line is the one that acts, so a download
# cut short while piped into bash runs nothing.
main "$@"
