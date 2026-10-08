# Handoff: a few clicks once, then nothing until the end

A Claude Code cloud agent turns RomMix into **Galleon**, your Argosy-style launcher for the Nova, from the public repository [github.com/Rad-Thad/galleon](https://github.com/Rad-Thad/galleon). A small program on the Nova tests every nightly build by itself while the Nova charges. You are not asked to test, report or review anything until one acceptance session near the end. Phase 0 is done and passed.

## Done for you by the local Claude session

You only need to say "go ahead" to the Claude session on your Mac. It runs [Appendix A](#appendix-a-commands-the-local-session-runs):

1. Lays this kit on top of the repository, pushes it, and creates the issue labels.
2. Protects `main` (a ruleset with **no bypass**, not even for deploy keys) and creates the `release` environment with you as the approver.
3. Installs the device bridge on the Nova over SSH and registers its deploy key with GitHub.
4. Puts on your clipboard, whenever you ask, each thing you paste below.

## What you do (about 15 minutes, once)

1. **Install the Claude GitHub App** (1 minute): <https://github.com/apps/claude> -> **Configure** -> your account -> **Only select repositories** -> `galleon` -> **Save**.
2. **Create the cloud environment** (3 minutes): at <https://claude.ai/code>, environment selector -> **Add environment**. Name `galleon`. Network access **Custom**: keep "include the default allowed domains" ticked and add `nodejs.org`. No environment variables. **Setup script:** ask the Mac's Claude to "copy the setup script", paste, **Save**.
3. **Create the Project** (5 minutes), the main engine, whose work waits out usage limits and carries on: at <https://claude.ai/code>, **Projects** -> **New project**, repository `galleon`, environment `galleon`. For **Instructions**, ask to "copy the project instructions" and paste. Start the first thread with the most autonomous permission mode offered, pasting "the kickoff prompt". (No Projects on your account yet? Skip this step; the Routine below does the work alone.)
4. **Create the heartbeat Routine** (3 minutes): <https://claude.ai/code/routines> -> **New routine**. Name `galleon-heartbeat`, repository `galleon`, environment `galleon`, the strongest model offered. **Prompt:** ask to "copy the routine prompt" and paste. **Connectors:** remove all. **Trigger:** Schedule, **Hourly**. No API trigger and no secrets.
5. **Maybe, once:** if the Mac's Claude says it could not reuse your RomMix sign-in for the tests, open the address it shows in a browser where you are signed in to RomM and approve. That adds a read-only "Galleon device tests" device.

The repository is public, so GitHub's build machines (including the ARM ones) cost nothing.

## One habit, when it suits you

Leave the Nova **on its charger, in Game Mode, at Steam's library** overnight (quit any game, RomMix or ES-DE first), and set Steam's **Settings -> Power -> Sleep when plugged in** to **Never** once. Results then show up automatically. If the Nova is away or asleep for days, nothing breaks; the features that need it simply wait.

## What you will see, and when

| When                      | What                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| From day one              | Nothing you need to look at. The agent opens and merges its own pull requests.                                                                                                                              |
| Some nights, 1 to 7 a.m.  | The Nova lights up with Galleon and a few emulators for up to half an hour, sound muted. **Any button stops it.** A "Galleon Device Test" entry in Steam does nothing if you start it.                      |
| Rarely                    | A GitHub e-mail with one question (for example which exit button combo you prefer). Answer if you like; after three days the agent takes the safe default the question names.                               |
| Near the end (weeks away) | **One e-mail: "Galleon is ready for your acceptance session."** Open the Claude session on your Mac and say **"start the Galleon acceptance session"**. About two hours, and Galleon is installed for real. |

Nothing the agent or the bridge does can change your RomM server, your saves, your RomMix, your emulator settings or your Steam setup beyond the "Galleon Device Test" shortcuts. Every test run checks that.

## Pausing or stopping

| To                           | Do                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Pause development            | Pause the Project, and at <https://claude.ai/code/routines> toggle `galleon-heartbeat` off. Turn them on to resume. |
| Stop a run in progress       | Open the session at claude.ai/code and press **Stop**.                                                              |
| Stop the night tests         | Ask the Mac's Claude to "stop the Galleon device bridge" (it disables the Nova's timer).                            |
| Cut the Nova off from GitHub | Ask the Mac's Claude to "remove the Galleon deploy key".                                                            |
| Cut the agent off completely | github.com -> Settings -> Applications -> Claude -> **Configure** -> remove `galleon`.                              |

---

## Appendix A: commands the local session runs

For the local Claude session on the Mac, with `gh` signed in as the owner and `ssh nova` working. Stop and report at the first error.

**A1. Lay the kit on the repository** (`main` is RomMix v0.20.0, commit `ea787b98`, with RomMix's tags not pushed):

```bash
set -euo pipefail
OWNER=Rad-Thad NAME=galleon KIT=~/projects/romm-launcher-handoff
WORK=$(mktemp -d)/$NAME
git clone "https://github.com/$OWNER/$NAME" "$WORK" && cd "$WORK"
test "$(git rev-parse HEAD)" = ea787b98c32ce6efcd0c0448c0dac5aed074f3af   # RomMix v0.20.0, untouched
rsync -a --exclude '.DS_Store' "$KIT"/ ./
git rm -r -q --ignore-unmatch .claude/skills .agents skills-lock.json \
  .github/FUNDING.yml .github/workflows/pages.yml .github/ISSUE_TEMPLATE/emulator.yml
# Fill the placeholders everywhere except this file and features.json, which quote them on purpose.
files=$(grep -rl --exclude-dir=.git --exclude=HANDOFF.md --exclude=features.json -e '__GH_OWNER__' -e '__REPO__' . || true)
[ -z "$files" ] || printf '%s\n' "$files" | xargs sed -i '' -e "s/__GH_OWNER__/$OWNER/g" -e "s/__REPO__/$NAME/g"
! grep -rn --exclude-dir=.git --exclude=HANDOFF.md --exclude=features.json -e '__GH_OWNER__' -e '__REPO__' .
npx --yes prettier@3.9.9 --check .
git add -A
git commit -m "docs: add the autonomous development kit on top of RomMix v0.20.0"
git push origin main   # the only direct push to main; the ruleset below forbids the next one
ruby -ryaml -e 'YAML.load_file(".github/labels.yml").each { |l| puts [l["name"], l["color"], l["description"]].join("\t") }' |
  while IFS=$'\t' read -r n c d; do gh label create "$n" --repo "$OWNER/$NAME" --color "$c" --description "$d" --force; done
```

**A2. Protect `main` and create the `release` environment** (the two check names already exist from the first CI run):

```bash
gh api -X POST "repos/$OWNER/$NAME/rulesets" --input - <<'JSON'
{
  "name": "protect main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [ { "context": "build (ubuntu-24.04, x64)" }, { "context": "build (ubuntu-24.04-arm, arm64)" } ] } }
  ]
}
JSON
ME=$(gh api user --jq .id)
gh api -X PUT "repos/$OWNER/$NAME/environments/release" --input - <<JSON
{ "reviewers": [ { "type": "User", "id": $ME } ] }
JSON
```

The bypass list must stay empty: the agent acts as the owner, and deploy keys are a bypass option. Never add either.

**A3. Install the device bridge on the Nova:**

```bash
scp -r "$KIT/tools/device-bridge" nova:/tmp/galleon-device-bridge
ssh nova "sh /tmp/galleon-device-bridge/install.sh --repo $OWNER/$NAME"
ssh nova cat .config/galleon-device-bridge/deploy_key.pub > /tmp/galleon-bridge.pub
gh repo deploy-key add /tmp/galleon-bridge.pub --repo "$OWNER/$NAME" --allow-write --title "Galleon device bridge (Nova)"
rm /tmp/galleon-bridge.pub
ssh nova '~/.local/bin/galleon-device-bridge doctor'
```

Every `doctor` line should be `OK`, `INFO`, or a `WARN` you understand ("no nightly release published yet" is expected until M0-24). If it says the sign-in cannot be imported, run `ssh -t nova '~/.local/bin/galleon-device-bridge pair-readonly'` and ask the owner to approve the code it prints. If the Nova is asleep or away, do A3 the next time `ssh nova true` works; nothing else waits for it.

**A4. What the owner pastes** (one at a time, when asked):

```bash
pbcopy < "$KIT/docs/cloud-environment-setup.sh"                                    # "the setup script"
part() { awk -v n="$1" '$0 ~ "END " n {f=0} f; $0 ~ "BEGIN " n {f=1}' "$KIT/docs/KICKOFF-PROMPT.md"; }
part project-instructions | pbcopy                                                 # "the project instructions"
part kickoff | pbcopy                                                              # "the kickoff prompt"
part routine | pbcopy                                                              # "the routine prompt"
```

**A5. Later, on request:** stop the night tests with `ssh nova 'systemctl --user disable --now galleon-device-bridge.timer'`; remove the deploy key with `gh repo deploy-key list --repo "$OWNER/$NAME"` then `gh repo deploy-key delete <id> --repo "$OWNER/$NAME"`. For the acceptance session, read `docs/ACCEPTANCE.md` on `main` and follow it.
