#!/usr/bin/env bash
#
# Claude Code's SessionStart hook (.claude/settings.json), for cloud sessions
# only: Node 24 first on PATH for the rest of the session, and the session
# ritual from CLAUDE.md printed where the session reads it first.
#
# The ritual is cut from CLAUDE.md rather than copied here, so there is one
# version of it to keep right.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [ -n "${CLAUDE_ENV_FILE:-}" ] && /usr/local/bin/node --version 2>/dev/null | grep -q '^v24\.'; then
  # Single quotes on purpose: the line is expanded by the session that reads
  # the file, against the PATH it has then.
  # shellcheck disable=SC2016
  echo 'export PATH="/usr/local/bin:$PATH"' >>"$CLAUDE_ENV_FILE"
fi

awk '/^## Session ritual/ { on = 1 } on && /^## / && !/^## Session ritual/ { exit } on' "$root/CLAUDE.md"
exit 0
