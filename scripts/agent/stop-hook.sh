#!/usr/bin/env bash
#
# Claude Code's Stop hook (.claude/settings.json): a turn that changed code
# does not end while scripts/agent/check.sh fails.
#
# Only when the branch touches what the checks are about: a turn that edited
# docs alone is not held up for a few minutes of tests. Exit code 2 is the
# hook's way of refusing the stop; what it prints on stderr goes back to the
# session as the reason, so it ends with the part of the log that failed.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# Changed against main, committed or not, plus files git has not seen yet.
changed=$(
  {
    git diff --name-only origin/main 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | grep -E '^(src|test|packaging|scripts|native)/' || true
)
[ -z "$changed" ] && exit 0

log=$(mktemp)
if scripts/agent/check.sh >"$log" 2>&1; then
  rm -f "$log"
  exit 0
fi

{
  echo 'scripts/agent/check.sh fails on this branch; fix it before stopping. The end of its output:'
  tail -n 40 "$log"
} >&2
rm -f "$log"
exit 2
