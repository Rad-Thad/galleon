> Research note copied into the repository at handoff (2026-10-08). Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; see [argosy-fork-design-spec.md](argosy-fork-design-spec.md) for the extracted design.

# Autonomous "set it and forget it" development of an aarch64 RomM launcher in Claude Code cloud sessions: workflow, infrastructure, verified capabilities and limits

Research date: 2026-10-08. Unless a finding gives another date, all Claude Code doc pages were fetched live on that date from code.claude.com. Claude Code is versioned v2.1.2xx at this point; the docs cite feature gates up to v2.1.289. Routines and Projects are labeled research preview and public beta, so their limits and API may change. "Verified" below means stated in a primary source I fetched. "Inference" means my own reasoning.

## 1. Claude Code cloud sessions (Claude Code on the web): starting, runtime, Docker, network, environments, secrets, repo config, branches/PRs, messaging, teleport, cost

### Takeaway
A cloud session is a fresh Ubuntu 24.04 **x86_64** VM: 4 vCPU, 16 GB RAM, 30 GB disk. It has Docker and docker compose pre-installed and network access through an allowlist that includes Docker Hub, GHCR, GitHub and Ubuntu mirrors. The agent can therefore run a real RomM server plus MariaDB/Redis in containers inside its own session. It cannot reach the user's LAN, it cannot natively execute aarch64 binaries, and it cannot push git tags. Sessions persist after the laptop closes, can be messaged from the CLI (`claude -p ... --cloud <id>`) and teleported to a terminal. They draw on the same subscription limits as all other Claude usage, and there is no separate compute charge.

### Cited Findings
**Starting sessions and GitHub access**
- Cloud sessions are available on Pro, Max and Team plans, and to Enterprise users with premium seats or Chat + Claude Code seats. They run on Anthropic-managed infrastructure, and "the session keeps running after you close your laptop." — [Claude Code docs: Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Sessions can be started from several surfaces:
  - claude.ai/code (browser)
  - the Code tab in the Claude mobile app
  - the Desktop app, by selecting "Cloud"
  - the terminal, with `claude --cloud "task"` (`--remote` is a deprecated alias)
  - routines

  — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- `--cloud` clones the GitHub remote at the current branch, not the local checkout, so local commits must be pushed first. Each `--cloud` call creates an independent session, so several can run in parallel. — [same](https://code.claude.com/docs/en/claude-code-on-the-web)
- There are two GitHub auth methods. The **Claude GitHub App** grants access to any public repo plus private repos where it is installed. `/web-setup` sends the local `gh` token instead. Auto-fix, Projects and routine GitHub triggers require the GitHub App. — [same](https://code.claude.com/docs/en/claude-code-on-the-web); [Routines](https://code.claude.com/docs/en/routines)

**VM, tools and resource ceilings**
- The VM is "a fresh virtual machine (VM) running Ubuntu 24.04 on x86_64, regardless of your own operating system and CPU architecture." — [Configure cloud environments](https://code.claude.com/docs/en/cloud-environments)
- Pre-installed tools:
  - Python 3.x (pip, poetry, uv, pytest, ruff)
  - Node 20/21/22
  - Ruby, PHP 8.3, OpenJDK 21, Go, Rust (rustc/cargo)
  - GCC, Clang, cmake, ninja, conan
  - **Docker: docker, dockerd, docker compose**
  - **PostgreSQL 16, Redis 7.0**
  - git, gh, jq, yq, ripgrep, tmux

  MariaDB is **not** pre-installed. — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- The docs say: "Docker is available for running containerized services. Ask Claude to run `docker compose up`… Network access to pull images follows your environment's access level, and the Trusted defaults include Docker Hub and other common registries." Putting `docker compose pull` in the setup script caches the images, but "the cache stores files only, not running processes," so containers must be started each session. — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- Resource ceilings are approximate: "4 vCPUs, 16 GB of RAM, 30 GB of disk." The VM "may stop tasks that need significantly more memory." Replacing the base image "isn't supported yet." You can install on top of it, or run your own image as a container alongside Claude with docker compose. — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)

**Time limits and session lifetime**
- Bash commands time out after 2 minutes by default, and Claude can request up to 10 minutes. On timeout a command moves to the background and may run "up to 30 more minutes."
- `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` can be raised through environment variables.
- SessionStart hooks are cancelled after 600 s unless the hook sets its own `timeout`.
- A setup script is cached only if it finishes in about 5 minutes.
- An idle VM pauses "after a few minutes without activity" and can later be reclaimed.

— [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- When a session's environment expires, reopening it provisions a fresh VM. The conversation history is restored. "Background work that was still running when the VM was reclaimed, such as subagents and shell commands," is not. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

**Network access**
- There are four network access levels: **None**, **Trusted** (the default allowlist), **Full** (any domain) and **Custom** (your own list, optionally plus the defaults). GitHub (via its proxy), MCP connectors and the Anthropic API stay reachable at every level. — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- The Trusted allowlist includes:
  - github.com, api.github.com, raw.githubusercontent.com, objects.githubusercontent.com, release-assets.githubusercontent.com, codeload.github.com
  - registry-1.docker.io, auth.docker.io, hub.docker.com, production.cloudflare.docker.com, ghcr.io, gcr.io, public.ecr.aws
  - *.ubuntu.com, archive.ubuntu.com, ppa.launchpad.net
  - pypi.org, crates.io, static.rust-lang.org, registry.npmjs.org
  - sourceforge.net, *.nixos.org

  **Not** listed: flathub.org / dl.flathub.org, itch.io, docs.romm.app, demo.romm.app. Hosts outside the list fail with `403` and `x-deny-reason: host_not_allowed`. — [Cloud environments](https://code.claude.com/docs/en/cloud-environments); [Routines](https://code.claude.com/docs/en/routines)

**GitHub proxy**
- In Anthropic-hosted environments, every GitHub operation goes through a proxy. The proxy:
  - "rejects branch deletions and pushes of anything other than a branch, such as a tag," and "doesn't limit which branches a push can update. To do that, use branch protection rules or rulesets"
  - serves API calls only for the repos attached to the session
  - **rejects GraphQL**, so `gh pr` and `gh issue` subcommands get a 403. Use `gh api repos/{owner}/{repo}/...` (REST) or the built-in GitHub tools instead.

  — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- `GH_TOKEN`/`GITHUB_TOKEN` read as the placeholder `proxy-injected` unless you set your own. The proxy substitutes real credentials, but "a script that reads GITHUB_TOKEN directly gets the placeholder." — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)

**Environments, setup scripts and secrets**
- Setup scripts run as root on Ubuntu 24.04 before Claude Code launches, and they must exit 0.
- After a successful setup, the filesystem is snapshotted and reused. The cache rebuilds when the script or allowed hosts change, and on expiry after about 7 days.
- SessionStart hooks run on every start or resume, both locally and in the cloud. Scope them to the cloud with `CLAUDE_CODE_REMOTE=true`.

— [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- Environment variables (in .env format) are visible to anyone who uses the environment. **Network secrets** are available on Pro and Max only, not yet on Team or Enterprise. The agent proxy attaches them to requests for the listed hosts, so the key never enters the VM. The target API must accept connections from the internet. Secrets are never attached to GitHub, the Anthropic API, public package registries, or setup-script requests. — [Cloud environments](https://code.claude.com/docs/en/cloud-environments)

**What the repo carries into a cloud session**
- These load from the repo: `CLAUDE.md`, `.claude/settings.json` hooks and permissions (single-repo sessions only), `.mcp.json` (single-repo), `.claude/rules/`, `.claude/skills/`, `.claude/agents/` and `.claude/commands/`.
- These do **not** load: plugins declared in the repo's settings, the user's `~/.claude/CLAUDE.md`, user skills and agents, and user-scope MCP servers.

— [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- Subagents work as they do locally, and repo `.claude/agents/` are picked up. Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. `/compact` and `/context` work; `/clear` does not, so start a new session instead. Cloud sessions set their own auto-compact threshold. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

**Plan mode and permissions**
- The docs recommend "Plan locally, execute in the cloud": run `claude --permission-mode plan`, save the plan to the repo, push, then run `claude --cloud "Execute the migration plan in docs/migration-plan.md"`. The permission mode is chosen from a dropdown in cloud sessions. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

**Branches, PRs and traceability**
- When a session completes, you can create a PR from claude.ai/code. Commits carry a `Claude-Session: <url>` trailer, and PR bodies include the session URL. The session ID is available as `CLAUDE_CODE_REMOTE_SESSION_ID`. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web); [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- **Auto-fix PRs** require the Claude GitHub App. Claude subscribes to the PR's CI failures and review comments, pushes a fix when one is clear, and asks when a request is ambiguous. It "can't react to conflicts on its own" because GitHub emits no webhook for them. Replies post under the user's GitHub account, labeled as Claude Code. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

**Messaging and resuming sessions**
- `claude -p "msg" --cloud <session-id>` queues a message into a running session from any logged-in machine, including CI scripts. `--output-format json` returns `{ok, session_id, url}`. Archived sessions reject messages. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- An idle session that asked a question can still be answered later, "up to environment expiry." — [same](https://code.claude.com/docs/en/claude-code-on-the-web)

**Teleport between cloud and terminal**
- `claude --teleport [id]`, `/teleport` or `/tp` pulls a cloud session into the terminal. It checks out the session's branch and loads the full history.
- Teleport needs a clean git state, the same repo (not a fork), the same account, and a pushed branch.
- From the CLI, handoff is one-way (cloud to local). The Desktop app can send a local session to the cloud.

— [same](https://code.claude.com/docs/en/claude-code-on-the-web)
- Remote Control is separate: it steers a **local** session from a phone or browser, using that machine's network and files. — [same](https://code.claude.com/docs/en/claude-code-on-the-web); [Cloud environments](https://code.claude.com/docs/en/cloud-environments)

**Cost and usage limits**
- "Cloud sessions share rate limits with all other Claude and Claude Code usage within your account… There is no separate compute charge for the cloud VM." — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Subscription usage resets on "a rolling five-hour window and a weekly window." This wording comes from the Team/Enterprise section. You can keep working past the limits with usage credits, and `/usage` shows the bars. On a subscription the prompt-cache lifetime is 1 hour; it drops to 5 minutes once you are drawing on usage credits.
- Enterprise averages are "around $13 per developer per active day and $150-250 per developer per month," and 90% of users stay below $30 per active day.
- "Aim to keep CLAUDE.md under 200 lines."

— [Manage costs](https://code.claude.com/docs/en/costs)
- Third-party reports say Anthropic doubled the 5-hour limits for Pro, Max, Team and seat-based Enterprise on 6 May 2026. Reports of a temporary ~50% weekly increase (May to July 2026) are **not** confirmed by Anthropic, and Anthropic does not publish exact per-plan numbers. — [verdent.ai guide](https://www.verdent.ai/guides/claude-code-limits-doubled-may-2026); [morphllm](https://www.morphllm.com/claude-code-usage-limits) (secondary sources; treat as unverified)

### Inferences
- **Two consequences of the x86_64 VM:**
  - The launcher must also build and run on x86_64 Linux (e.g. under Xvfb), so the cloud agent can run unit, integration and screenshot tests itself.
  - aarch64-specific builds and tests have to happen in GitHub Actions on `ubuntu-24.04-arm`. Using QEMU user-mode inside the VM is untested (see Gaps).
- **A real RomM server can run inside the session.** Docker Hub is on the Trusted list and Docker is pre-installed, so the agent can `docker compose up` RomM + MariaDB + Redis from a committed `docker-compose.test.yml`. The setup script should pre-pull images and stay under 5 minutes so they are cached. A SessionStart hook gated on `CLAUDE_CODE_REMOTE` should start the stack. This closes most of the "no LAN access to RomM" gap for development.
- **Releases cannot come from a git tag push.** The proxy rejects tag pushes, so releases should be created by GitHub Actions or by a human. Whether `gh api POST /repos/.../releases`, which creates the tag server-side, is allowed through the proxy is unverified.
- **GitHub CLI usage.** Because of the GraphQL ban, CLAUDE.md should tell the agent to use `gh api` REST calls and the built-in GitHub tools rather than `gh issue` or `gh pr`.
- **Protect `main`.** The proxy does not restrict which branches the agent can push to, so main needs a ruleset that requires CI status checks and PRs, with no bypass for the owner's identity. Routine pushes act as the owner (see section 2).
- **Secrets.** Real secrets (e.g. a RomM demo token, or IGDB/ScreenScraper keys if ever needed) should be network secrets on a Pro or Max plan, never environment variables. Normally the dev RomM in Docker needs no external keys.

### Gaps
- The docs give **no maximum wall-clock lifetime** for a single cloud session, only the idle pause/reclaim behavior and per-command timeouts.
- Whether **QEMU/binfmt_misc** (e.g. `docker run --privileged tonistiigi/binfmt` or `--platform linux/arm64`) works inside the Anthropic VM is unknown. Docker is present, but privileged binfmt registration is not documented.
- Whether creating a GitHub Release through `gh api` REST passes the GitHub proxy is unverified.
- Exact Pro/Max usage quotas are not published. Check them with `/usage`.

## 2. Unattended automation: Routines (scheduled cloud agents), Projects, /goal, and the Claude Code GitHub Action, including issue triage

### Takeaway
Routines are saved prompt + repo + environment configurations. They run autonomously as cloud sessions, with no permission prompts, on a schedule (minimum interval 1 hour), on an API `/fire` call, or on GitHub **pull_request/release** events. **Issue events are not supported**, so issue pickup needs one of three approaches:
- an hourly or daily scheduled routine that polls issues
- a GitHub Actions workflow on `issues` that POSTs to the routine's `/fire` endpoint
- the Claude Code GitHub Action running directly on `issues` events, which can run on an arm64 runner

Projects (public beta, Pro/Max) add a coordinator that spawns cloud "threads," keeps project memory, and watches PRs. Threads wait out usage limits automatically.

### Cited Findings
**Routines**
- Routines are in research preview, and "Behavior, limits, and the API surface may change." They are available on Pro, Max, Team and Enterprise, and are managed at claude.ai/code/routines or with `/schedule` (alias `/routines`) in the CLI. — [Routines docs](https://code.claude.com/docs/en/routines); launch date 14 April 2026 per [secondary source](https://codex.danielvaughan.com/2026/04/14/claude-code-routines-launch/)
- "Routines run autonomously as full Claude Code cloud sessions: there is no permission-mode picker, and the session runs shell commands, uses skills committed to the cloned repository, and calls any connectors you include, all without stopping for approval." — [Routines](https://code.claude.com/docs/en/routines)
- Each run clones the default branch and "Claude creates `claude/`-prefixed branches" unless the prompt says otherwise. Commits and PRs carry the owner's GitHub user.
- On push rules: "a rule that access can bypass doesn't block a run's push."
- If the GitHub connection is missing, runs are skipped for up to 72 hours, after which the routine turns off.

— [Routines](https://code.claude.com/docs/en/routines)
- **Schedule triggers:**
  - Presets are hourly, daily, weekdays and weekly. Custom cron is set with `/schedule update`.
  - "The minimum interval is one hour."
  - One-off runs are supported.
  - On-the-hour runs can start several minutes late, so use e.g. 9:07.

  — [Routines](https://code.claude.com/docs/en/routines)
- **API trigger:**
  - Endpoint: `POST https://api.anthropic.com/v1/claude_code/routines/<trig_id>/fire`, with a bearer token plus the `anthropic-beta: experimental-cc-routine-2026-04-01` and `anthropic-version: 2023-06-01` headers.
  - An optional `text` field arrives wrapped in a `<routine-fire-payload>` block labeled untrusted, so "a routine's saved prompt must opt in to acting on fire text."
  - Tokens are created only on the web and shown once.

  — [Routines](https://code.claude.com/docs/en/routines)
- **GitHub triggers:**
  - Supported events: **Pull request** (opened, closed, assigned, labeled, synchronized…) and **Release** (created, published, edited, deleted) only.
  - PR filters cover author, title, body, base/head branch, labels, is-draft and is-merged.
  - The Claude GitHub App is required; `/web-setup` alone does not enable webhooks.
  - Webhook events are subject to per-routine and per-account hourly caps.

  — [Routines](https://code.claude.com/docs/en/routines)
- **Limits:**
  - 100 scheduled runs per hour per account.
  - 30 per hour per routine for Run now + API fires combined.
  - 100 API fires per hour per account.
  - No overage on these hourly limits.
  - Runs draw subscription usage like interactive sessions; past the limit they need usage credits, otherwise "additional runs are rejected until your usage window resets."

  — [Routines](https://code.claude.com/docs/en/routines)
- A third-party guide claims **daily** run caps of 5 (Pro), 15 (Max) and 25 (Team/Enterprise). The official routines page fetched 2026-10-08 lists only hourly limits. **Conflict, unresolved.** — [secondary summary in search results](https://www.dsebastien.net/claude-code-routines/) vs [official Routines docs](https://code.claude.com/docs/en/routines)
- "A green status in the run list means the session started and exited without an infrastructure error. It does not mean the task in your prompt succeeded." — [Routines](https://code.claude.com/docs/en/routines)
- Connectors attached to a routine can perform writes without asking. All connected connectors are included by default, so remove the ones you don't need. — [Routines](https://code.claude.com/docs/en/routines)

**Projects**
- Projects are in "public beta on Pro and Max plans and rolling out gradually"; not on Team or Enterprise.
- A project conversation coordinates **threads**. Each thread is a separate cloud session on its own branch that "opens a pull request when the work calls for one" and then watches it with auto-fix.
- The Overview pane shows Ready for review, Waiting on you, Landing, Idle and Resolved. Threads auto-resolve "after a week with no activity."

— [Projects docs](https://code.claude.com/docs/en/claude-projects)
- **Project memory** is a `MEMORY.md` index that every cloud thread reads at start. **Project instructions** go to every new thread and can be up to 16,000 characters. Each thread also reads the repo's `CLAUDE.md`. — [Projects](https://code.claude.com/docs/en/claude-projects)
- **Usage:**
  - "The enforced limit is 200 new threads per day across your projects."
  - "A thread that reaches your plan's limit waits and continues on its own when the limit resets."
  - **Exception:** "A thread that a routine started doesn't wait: its turn stops with a limit error."
  - An idle project with no running threads, watched PRs or messages uses no quota.

  — [Projects](https://code.claude.com/docs/en/claude-projects)
- A project thread can run on the user's own computer through Remote Control. Such a thread "runs only while that computer is awake" and does not load project memory files. — [Projects](https://code.claude.com/docs/en/claude-projects)

**/goal and Stop hooks**
- `/goal <condition>` keeps Claude taking turns until a small-fast-model evaluator judges the condition met or impossible.
- The condition can be up to 4,000 characters. Add a clause like "or stop after 20 turns" to bound it.
- It works with `-p` (non-interactive). The loop stops if several turns pass without tool use.
- Use it with auto mode for unattended runs.

— [/goal docs](https://code.claude.com/docs/en/goal)
- A Stop hook is the deterministic alternative: "runs your check as a script and blocks the turn from ending until it passes." — [Best practices](https://code.claude.com/docs/en/best-practices)

**Claude Code GitHub Action**
- The action is `anthropics/claude-code-action@v1`. It has an interactive mode (`@claude` mentions in issue or PR comments, or in a new issue's title or body) and an automation mode (a `prompt` input on any event, including `schedule`).
- Auth is `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` on Pro, Max, Team or Enterprise. With the OAuth token, runs bill to the subscription.
- `claude_args` accepts `--max-turns`, `--model` and `--allowedTools`.

— [GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- **Who can trigger:** on issue and PR events "the triggering user must have write access" unless `allowed_non_write_users` is set. Bot actors are rejected unless listed in `allowed_bots`. — [GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- "GitHub runs scheduled workflows only from the default branch and, in public repositories, disables the schedule after 60 days without repository activity." — [GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- GitHub withholds secrets from runs triggered by fork PRs in public repos. — [GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- If the action is given `GITHUB_TOKEN`, Claude's pushes won't trigger CI. Let it authenticate as the Claude App instead. — [GitHub Actions docs](https://code.claude.com/docs/en/github-actions)

### Inferences
- **Recommended issue-pickup design (three layers):**
  - **(a) Primary:** a workflow `on: issues: [opened, labeled]` that, for maintainer-applied labels such as `tester-report` or `ready-for-agent`, `curl`s the routine `/fire` endpoint. The routine token is stored as a repo secret, and the `text` field carries the issue number and URL. The routine prompt says: "Read the issue referenced in the routine-fire-payload via `gh api`, reproduce it with a failing test, fix it, open a PR, and comment on the issue." This gives near-real-time pickup without polling.
  - **(b) Backstop:** a daily or hourly scheduled routine that triages anything labeled `needs-triage`. It applies labels (bug, enhancement, needs-info, duplicate), asks for missing info, picks the top `ready-for-agent` item from `ROADMAP`/`features.json`, and works on it. The scheduled routine is also the "continue the roadmap" engine.
  - **(c) Alternative:** `claude-code-action` on `issues` events, running on `ubuntu-24.04-arm`. The agent then executes natively on aarch64, but this needs an API key or OAuth token in repo secrets, and the tester's account must have write access or be in `allowed_non_write_users`.
- **Release testing hook:** a routine on GitHub `release.published` can generate the per-release test checklist issue automatically.
- **Prompt-injection guard:** a public repo means anyone can file issues. Gate agent action on a **label only the maintainer or tester can apply**, keep connectors minimal, and rely on the routine's untrusted-payload wrapping.
- **Projects vs routines:** Projects suit "keep feeding work" (paste tester notes in, get PRs out), and their threads ride out usage-limit resets. Routine-started threads do not, so schedule cadence should match the quota.
- **Possible LAN bridge:** a Projects thread run on a home PC through Remote Control could reach the LAN RomM server and even SSH into the handheld. This trades autonomy for the PC being awake. Inference only; not tested.

### Gaps
- No official confirmation either way on daily routine caps.
- The per-account and per-routine hourly caps for GitHub webhook events are not quantified in the docs.
- Whether Projects is available on this user's account (gradual rollout) is unknown.

## 3. Planning artifacts and practices that make long-running autonomous agents succeed

### Takeaway
Anthropic's own guidance converges on:
- a **machine-readable feature list with pass/fail status** (JSON, edited only to flip `passes`)
- a **progress log** plus git history
- an **init script** that boots the app and runs a smoke test first
- **one feature per session**
- **end-to-end verification as a user would**
- **separating the evaluator from the generator**
- a **short CLAUDE.md** (under 200 lines), with workflows moved into skills and must-always rules into hooks

### Cited Findings
**"Effective harnesses for long-running agents" (Justin Young, 26 Nov 2025)**
- Source: [Anthropic engineering](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- An **initializer agent** creates `init.sh`, `claude-progress.txt`, an initial commit, and a feature list. In the claude.ai-clone example the list had over 200 features, all initially failing. Each feature has a category, description, test steps and a `passes` boolean.
- The prompt warned: "It is unacceptable to remove or edit tests." JSON was chosen because the model is less likely to tamper with it inappropriately than with Markdown.
- Coding agents work on **one feature per session**. The authors call this "critical" to counter the tendency to do too much at once.
- Each session starts the same way: `pwd`, read git log and the progress file, read the feature list and pick the highest-priority unfinished item, run `init.sh` and a basic e2e check before new work. It ends with a commit and a progress update, leaving the code "appropriate for merging to a main branch."
- Without explicit prompting, Claude marked features done after only unit tests or curl. Browser automation such as Puppeteer MCP, testing "as a human user would," fixed this.
- Failure-mode table: declaring victory early → structured feature list; buggy or undocumented state → git + progress notes + a startup smoke test; time wasted figuring out how to run the app → `init.sh`.

**"Harness design for long-running application development" (Prithvi Rajasekaran, 24 Mar 2026)**
- Source: [Anthropic engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- Three agents: a **planner** (spec), a **generator**, and an **evaluator** that exercises the live app with Playwright. They communicate through files.
- **Sprint contracts** agree on what will be built and how it will be verified before coding; Sprint 3 had 27 criteria.
- Agents "confidently praise the work" when grading themselves, and an out-of-the-box Claude QA agent "talked itself into approving." A separate, skeptically tuned evaluator works better.
- Cost data: a solo run took 20 min and cost $9; the full harness took 6 hr and cost $200. A simplified harness built a DAW in about 3 h 50 m for $124.70.
- With Opus 4.6 the sprint construct was removed and the evaluator moved to a single end pass. The planner was kept because "the generator under-scoped without the planner."
- Lesson: "every component in a harness encodes an assumption about what the model can't do on its own"; re-test those assumptions with each model.

**Claude Code best practices (docs)**
- Source: [Best practices](https://code.claude.com/docs/en/best-practices)
- "Give Claude a check it can run… It's the difference between a session you watch and one you walk away from."
- There are four ways to gate completion: in the prompt, `/goal`, a Stop hook, or a verification subagent. Have Claude show evidence (test output, screenshots) rather than assert success.
- Explore → plan → implement → commit, using plan mode for multi-file or uncertain changes.
- For large features, have Claude interview you and write `SPEC.md`, then execute in a fresh session. "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step."
- CLAUDE.md rules:
  - keep it short
  - include commands Claude can't guess, style deviations, test instructions, branch and PR etiquette, architectural decisions and gotchas
  - exclude anything derivable from code and anything that changes frequently
  - "Bloated CLAUDE.md files cause Claude to ignore your actual instructions."
- "Use hooks for actions that must happen every time with zero exceptions." Skills hold on-demand workflows, for example a `fix-issue` skill.
- Add an adversarial review subagent. "Tell the reviewer to flag only gaps that affect correctness or the stated requirements," to avoid over-engineering.
- Named failure patterns: the kitchen-sink session, correcting over and over, the over-specified CLAUDE.md, the trust-then-verify gap, and infinite exploration.

**Other sources**
- Projects docs recommend project instructions that cover where work happens, how a thread checks its work, and "what needs your go-ahead." Example rule: "Don't merge, force-push, or change CI configuration without asking me in the thread." — [Projects](https://code.claude.com/docs/en/claude-projects)
- "Aim to keep CLAUDE.md under 200 lines"; move specialized instructions into skills. — [Manage costs](https://code.claude.com/docs/en/costs)

### Inferences
**Proposed repo artifacts (synthesized from the sources above)**
- `CLAUDE.md` (under 150 lines) should contain:
  - build, test and run commands for x86_64 dev, including Xvfb
  - "use `gh api` REST, not `gh issue`/`gh pr`" (because of the GraphQL ban)
  - branch naming (`claude/<issue#>-slug`) and one PR per feature or issue
  - never edit `features.json` except the `passes`, `evidence` and `notes` fields
  - never touch `.github/workflows/` or release config without a `needs-human` label
  - definition of done (see below)
  - pointers to `docs/ARCHITECTURE.md`, `docs/decisions/`, `PROGRESS.md`
- `docs/ROADMAP.md`: milestones M0–Mn, e.g. M0 skeleton + CI; M1 RomM auth/pairing; M2 library browse; M3 download + launch; M4 gamepad UI polish under gamescope; M5 self-update.
- `features.json`: per-feature id, milestone, priority, description, **acceptance criteria**, test steps (automated plus a manual step for the tester), `passes` (agent), `tester_verified` (human or maintainer label only).
- `PROGRESS.md`: an append-only log. Each session records date, session URL (`CLAUDE_CODE_REMOTE_SESSION_ID`), feature worked on, result, and next step.
- `docs/decisions/NNNN-title.md`: lightweight ADRs, so later agents don't re-litigate choices such as toolkit, packaging format, or RomM API version pin.
- `scripts/init.sh`: starts the RomM docker-compose stack, seeds it, builds the app, and runs a smoke test.
- **Definition of done:**
  - unit tests pass
  - integration tests pass against dockerized RomM
  - a screenshot test under Xvfb shows the expected screen, attached to the PR
  - the arm64 CI build is green
  - a manual tester step is written into the release checklist
  - `PROGRESS.md` is updated
- **Test-first:** for every tester bug, the agent first writes a failing test that reproduces it (as the docs' own "write a failing test that reproduces the issue, then fix it" example does), then fixes it.
- **Drift control:**
  - a Stop hook that runs `scripts/check.sh` (lint, unit tests and build), blocking the turn from ending while it fails
  - a reviewer subagent that compares the diff to the acceptance criteria and the out-of-scope list
  - one feature per session or routine run

### Gaps
- I did not fetch community write-ups on PLAN.md/ROADMAP conventions, such as the "Ralph loop" or spec-driven development. The synthesis above rests on Anthropic primary sources only.

## 4. CI for aarch64 on GitHub Actions: runners, AppImage/Flatpak, headless GUI, caching, release automation

### Takeaway
Free native arm64 Linux runners (`ubuntu-24.04-arm`, `ubuntu-22.04-arm`) have been generally available for **public** repos since 7 Aug 2025, with 4 vCPU. Flatpak can be built natively on them with flatpak-github-actions (`arch: aarch64`). AppImages can be built with appimagetool or linuxdeploy and made self-updatable with `gh-releases-zsync` update info. Headless GUI tests under Xvfb on arm64 need Xvfb installed explicitly and a Mesa build with llvmpipe.

### Cited Findings
**arm64 runners**
- "Linux and Windows arm64 standard hosted runners for public repositories" became GA on 7 Aug 2025. Labels are `ubuntu-24.04-arm`, `ubuntu-22.04-arm` and `windows-11-arm`. They are free, have 4 vCPU, and use an image managed by Arm, LLC. "Only available in public repositories." — [GitHub changelog 2025-08-07](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/)
- Ubuntu 26.04 and 26.04 Arm runner images were in public preview as of the Aug 2026 runner-image release notes. — [runner-images ubuntu24-arm64/20260804.84 (via newreleases.io)](https://newreleases.io/project/github/actions/runner-images/release/ubuntu24-arm64%2F20260804.84)

**Actions limits**
- 6 h per job, 35 days per workflow run, 256 jobs per matrix.
- 20 concurrent jobs on the Free plan.
- **10 GB cache per repository**, with upload/download rate caps.
- GITHUB_TOKEN: 1,000 requests/hour/repo.
- The page lists 500 MB artifact storage and 2,000 minutes/month for Free. Those apply to private-repo billing; the page doesn't separately state the public-repo terms.

— [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits)

**Flatpak**
- The flatpak-builder action has an `arch` input (default x86_64), and its cache key automatically includes the architecture. — [flatpak/flatpak-github-actions](https://github.com/flatpak/flatpak-github-actions)
- Projects such as Clapper moved from QEMU to native arm64 runners using a matrix `{ubuntu-24.04: x86_64, ubuntu-24.04-arm: aarch64}`. The job runs in the `ghcr.io/flathub-infra/flatpak-github-actions:gnome-XX` container with `--privileged`. — [flatpak-github-actions](https://github.com/flatpak/flatpak-github-actions); Clapper commit mirror in search results ([git.iohub.dev](https://git.iohub.dev/dany/clapper/commit/c29b8871a3d11b52ccee9982e02476f5e9e11e0f))

**AppImage**
- AppImage update info for GitHub Releases uses the format `gh-releases-zsync|<owner>|<repo>|latest|<pattern>.AppImage.zsync`, and zsync must be installed on the build machine. — [appimage-builder docs: AppImage Updates](https://appimage-builder.readthedocs.io/en/latest/advanced/updates.html)
- appimagetool can embed update info with `-u` and produce the `.zsync` file. It downloads the type2 runtime from GitHub by default, or uses `--runtime-file` for a pinned copy. Its Docker build scripts accept `ARCH=aarch64`. — [appimagetool docs](https://docsearch.algolia.com/mcp/docs/repo/appimage/appimagetool); yuzu commit ([git.openpunk.com](https://git.openpunk.com/OpenPunk/yuzu/commit/0d24b1a31b662146dca4444c7e22e0dddbc1f6bd))
- `appimageupdatetool` / AppImageUpdate performs delta updates from that metadata. — [AppImageUpdate wiki walkthrough](https://github.com/AppImageCommunity/AppImageUpdate/wiki/Example:-Step-by-step-walkthrough-with-%60appimageupdatetool%60)
- A 2022 report said linuxdeploy had no aarch64 build at the time. This is dated, and current status is unverified. — [Cinelerra mailing list, 2022](https://lists.cinelerra-gg.org/pipermail/cin/2022-March/004703.html)

**Headless GUI**
- On arm64, don't assume Xvfb is present; install it and start it yourself. Older Travis arm64 runners needed it added as a service. — [Travis CI community](https://travis-ci.community/t/start-xvfb-service-by-default-in-arm64/7626); [ModernGL CI guide](https://moderngl.readthedocs.io/en/5.8.2/install/using-moderngl-in-ci.html)
- Mesa builds without LLVM lose llvmpipe GL under Xvfb on non-amd64 platforms; Apertis disabled those tests as a result. Verify the renderer with `glxinfo -B`. — [Apertis mutter MR](https://gitlab.apertis.org/pkg/mutter/-/merge_requests/3)
- `LIBGL_ALWAYS_SOFTWARE=true` forces software rendering. — [GStreamer CI commit mirror](https://git.fasttube.de/FaSTTUBe/GST-Tensordecoder-ov_ep/commit/e6e2653bf8e8ed463a1872d971e415e6856f431f)
- gamescope has a headless backend (`--backend headless`). Issue #1984 reports only the cursor rendering in that mode. Capturing frames from inside the app is the more reliable screenshot route. — [gamescope issue #1984](https://github.com/ValveSoftware/gamescope/issues/1984); [DeepWiki gamescope CLI options](https://deepwiki.com/ValveSoftware/gamescope/5.1-command-line-options)

### Inferences
- **Proposed CI layout**, run on PRs and pushes to main:
  - (1) a `lint+unit` job on `ubuntu-24.04` and `ubuntu-24.04-arm`
  - (2) an `integration` job that brings up the RomM docker-compose stack (section 5) and runs API-client tests. Run it on arm64 too, since `rommapp/romm` and `mariadb` publish multi-arch images (assumption; verify the manifest).
  - (3) a `gui-smoke` job: Xvfb + llvmpipe, launch the app with `--screenshot-after=<screen>` and upload PNGs as artifacts so the agent or tester can inspect them
  - (4) a `package` job building the aarch64 AppImage (primary for armadaOS/Steam Game Mode: one file, easy to add as a non-Steam shortcut), with Flatpak optional
- **Caching:** `actions/cache` for toolchain and dependency caches (keyed by arch and lockfile), the flatpak-builder built-in cache, and Docker images through `docker save`/`load` to a cache if pulls are slow. Stay under the 10 GB per-repo cap.
- **Release channels:** neither tool below was verified in this research.
  - *Nightly:* on each green push to main (or a cron), a workflow force-updates a `nightly` prerelease, for example with `gh release` or softprops/action-gh-release, attaching `*-aarch64.AppImage`, `.zsync` and SHA256SUMS.
  - *Stable:* a human (or release-please on a merged release PR) creates a `vX.Y.Z` tag or release. The agent cannot push tags through the proxy, which conveniently keeps stable promotion human-gated.
  - Embed different zsync update strings per channel (e.g. `latest` vs a nightly tag), or have the in-app updater choose the channel through the Releases API.
- **Agent visibility into CI:** the cloud agent reads results with built-in GitHub tools or `gh api repos/.../actions/runs`, and auto-fix reacts to failing checks on its PRs.

### Gaps
- arm64 runner concurrency or queue limits are not documented on the limits page.
- The current aarch64 status of linuxdeploy and its plugins (e.g. Qt/GTK plugins) is unverified.
- Whether Ubuntu 24.04 arm64 Mesa ships llvmpipe with LLVM by default is not verified; it is believed true.
- No source confirmed a tested Xvfb + SDL/GL recipe on GitHub arm64 runners.

## 5. Integration testing against a real RomM server in CI (docker-compose MariaDB + Redis, seeded legal ROMs) and mock servers from openapi.json

### Takeaway
RomM's official compose example (`rommapp/romm:latest` + `mariadb:latest` with a healthcheck) can be adapted into a CI or cloud-session test stack. RomM serves an unauthenticated OpenAPI 3.0 spec at `/openapi.json`, which can drive a Prism mock (`prism mock -d`) for fast contract tests. Prism is stateless, so real-server tests remain necessary. Client auth should use RomM **Client API Tokens** (`rmm_…`) with its **device pairing** flow (an 8-digit code), which suits a handheld. Legally redistributable ROM fixtures exist: the 240p Test Suite ports are GPL, and Tobu Tobu Girl Deluxe appears to be MIT.

### Cited Findings
**RomM compose example**
- The official example has a `romm` service (`rommapp/romm:latest`) with these settings:
  - `DB_HOST=romm-db`, `DB_NAME`, `DB_USER`, `DB_PASSWD`
  - `ROMM_AUTH_SECRET_KEY` (generate with `openssl rand -hex 32`)
  - optional metadata keys: ScreenScraper, RetroAchievements, SteamGridDB; `HASHEOUS_API_ENABLED=true`
  - `SCAN_WORKERS=4`, `WEB_SERVER_CONCURRENCY=4`
  - volumes `/romm/library`, `/romm/assets`, `/romm/config`, `/romm/resources`, `/redis-data`
  - port mapping `80:8080`
  - `depends_on` romm-db healthy

  The `romm-db` service (`mariadb:latest`) has a healthcheck `healthcheck.sh --connect --innodb_initialized`, interval 10 s, start period 30 s, 5 retries. The example has **no separate Redis container**; Redis data lives in a `/redis-data` volume on the romm container. — [RomM docker-compose.example.yml](https://raw.githubusercontent.com/rommapp/romm/master/examples/docker-compose.example.yml)

**OpenAPI spec**
- "RomM ships its entire API as an OpenAPI 3.0 spec, served at {romm_url}/openapi.json. It's public and doesn't require auth." The docs recommend snapshotting it per version (e.g. `openapi-5.0.0.json`).
- Quirks: some loose `additionalProperties`, so responses may contain undeclared fields; socket.io/WebSockets are not in the spec; pagination defaults vary by endpoint.

— [RomM docs: Consuming OpenAPI (4.9.0)](https://docs.romm.app/4.9.0/developers/openapi/)
- Swagger UI is at `/api/docs` and ReDoc at `/api/redoc`. Breaking API changes only come in major versions. Docs exist for 4.9.x and 5.0.0, so a 5.x line exists. — [RomM API reference](https://docs.romm.app/4.9.0/developers/api-reference/) (via search summary)

**Client auth and pairing**
- **Client API Tokens** are long-lived per-user tokens, `rmm_` followed by 64 hex characters, sent as `Authorization: Bearer`. They are scope-narrowable, capped at 25 per user, and shown once.
- **Device pairing:** the web UI issues an 8-digit code through `POST /api/client-tokens/{id}/pair`. The device sends it to `POST /api/client-tokens/exchange` with `{ "code": "12345678" }` and receives the token. The code is valid for 5 minutes and single-use.
- The docs name **Argosy and Grout** as example companion implementations. OIDC logins don't yield API-usable tokens.

— [RomM Client API Tokens](https://docs.romm.app/4.9.0/developers/client-api-tokens/); [RomM API authentication](https://docs.romm.app/4.9.2/developers/api-authentication/) (via search summary; 5.0.0 page also exists)

**Prism**
- Prism provides "API mocking and contract testing" for OpenAPI 2.0, 3.0 and 3.1 and Postman Collections.
- Install with `npm install -g @stoplight/prism-cli` (Node ≥ 18.20.1) or the `stoplight/prism` Docker image.
- `prism mock <spec>` serves the mock; use `-h 0.0.0.0` inside Docker.
- `prism proxy <spec> <upstream>` validates a real API against the spec.
- The roadmap lists "Data Persistence" and a "Recording/Learning Mode," so Prism is **not stateful** today.

— [stoplightio/prism GitHub](https://github.com/stoplightio/prism)
- `-d` generates dynamic responses from the schema using Faker, and an `x-faker` schema extension picks specific generators. — [Prism overview](https://stoplight.io/open-source/prism); [Docker Hub stoplight/prism](https://hub.docker.com/r/stoplight/prism) (via search summaries)

**ROM fixtures**
- The 240p Test Suite is GPL. Its NES and Game Boy ports in pinobatch/240p-test-mini are GPLv2+ and built with cc65 and RGBDS. — [240p-test-mini](https://github.com/pinobatch/240p-test-mini); [WiiBrew](https://wiibrew.org/wiki/240p_Test_Suite)
- The Tobu Tobu Girl Deluxe repo is listed as MIT, with a CC BY 4.0 badge as well; read its LICENSE. The original Tobu Tobu Girl is free to download, but no explicit redistribution license was found. — [search summary; itch.io](https://tangramgames.itch.io/tobu-tobu-girl-deluxe/purchase)

### Inferences
- **Test stack (`docker-compose.test.yml`):**
  - pinned `rommapp/romm:<version>` (never `latest` in CI) and pinned `mariadb:<version>`
  - `ROMM_AUTH_SECRET_KEY` generated per run; metadata providers left blank or disabled, so there is no network dependence and no secrets
  - a fixture library bind-mounted at `/romm/library` using RomM's folder structure (e.g. `roms/nes/`, `roms/gb/`), holding GPL 240p-suite builds and MIT homebrew
  - for most tests, **tiny synthetic files with correct extensions** plus a few real homebrew ROMs for hash-matching paths
  - **BIOS stubs** as zero-filled or random placeholder files with the expected names, never real BIOS dumps
- **Seeding script:**
  1. wait for health
  2. create an admin user through the setup/first-user endpoint
  3. create a Client API Token (or exercise the pairing flow itself as a test)
  4. trigger a scan
  5. poll until the platforms and ROMs appear
- **Two test tiers:**
  - *Fast:* the generated client tested against Prism `mock -d` on a snapshotted `openapi-<pinned>.json`. Checks contract shape and error handling, and runs every commit, locally and in the cloud session.
  - *Real:* the RomM compose stack, testing auth, pairing, list, download and save-sync flows end to end. Runs in CI on both arches and inside the cloud session via Docker.
  - Optionally use `prism proxy` in front of the real stack to catch spec drift.
- **Spec drift guard:** a scheduled CI job fetches `/openapi.json` from the newest RomM image and diffs it against the pinned snapshot. If it changed, it opens an issue labeled `romm-api-change` for the routine to pick up.
- **WireMock-style recorded fixtures:** record real RomM responses from the dockerized stack (not the user's server) into JSON fixtures for deterministic UI tests. This avoids Prism's statelessness. Not researched in depth.

### Gaps
- Exact RomM first-user and setup API endpoints and the scan-trigger endpoint were not verified; read them from the pinned `openapi.json`.
- Whether RomM also supports PostgreSQL (which is pre-installed in cloud VMs) was not verified, so assume MariaDB via Docker.
- Multi-arch (arm64) availability of the `rommapp/romm` image was not verified.
- The latest Prism release version and date were not available on the repo page.

## 6. Low-effort tester feedback loop: in-app report, issue templates and labels, install/update, per-release checklists, automatic pickup

### Takeaway
Issue Forms (YAML in `.github/ISSUE_TEMPLATE/`, public preview) can auto-apply labels such as `needs-triage` and include file uploads. Paired with an in-app "Report a problem" that writes a diagnostics bundle and shows a QR code to a prefilled issue, plus an AppImage self-updater fed from GitHub Releases, the tester's loop shrinks to: update → test the checklist → scan the QR and attach the bundle. Pickup is handled by the routine and Actions wiring from section 2.

### Cited Findings
- **Issue Forms:**
  - YAML files live in `/.github/ISSUE_TEMPLATE`. Required keys are `name`, `description` and `body`; optional keys are `title`, `labels`, `assignees`, `projects` and `type`.
  - Body types are `markdown`, `input`, `textarea` (with `render`, e.g. `shell` for logs), `dropdown`, `checkboxes` and `upload` (e.g. "Upload screenshots").
  - "Currently in public preview and subject to change."

  — [GitHub docs: Syntax for issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
- The docs' examples also say: "Use issue templates to provide context up front" to reduce agent turns. — [Claude Code GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- AppImage self-update: embed `gh-releases-zsync|owner|repo|latest|*-aarch64.AppImage.zsync` and update with AppImageUpdate or appimageupdatetool. — [appimage-builder: AppImage Updates](https://appimage-builder.readthedocs.io/en/latest/advanced/updates.html); [AppImageUpdate wiki](https://github.com/AppImageCommunity/AppImageUpdate/wiki/Example:-Step-by-step-walkthrough-with-%60appimageupdatetool%60)
- RomM device pairing with an 8-digit code avoids typing a 68-character token on a handheld. — [RomM Client API Tokens](https://docs.romm.app/4.9.0/developers/client-api-tokens/)
- A routine on GitHub `release` events can react to `release.published`. — [Routines](https://code.claude.com/docs/en/routines)

### Inferences
**Labels**
- `needs-triage`: auto-applied by the forms.
- `tester-report`: applied by the form; this is the trigger label for the agent.
- `needs-info`, `bug`, `enhancement`, `regression`.
- `ready-for-agent`: maintainer-gated.
- `agent-in-progress` and `fix-available`: set by the agent with a link to the PR.
- `needs-retest`: set when a fix ships in a nightly.
- `tester-verified`: set only by the tester or maintainer. It closes the issue and is required before promotion to stable.
- `needs-human`: the agent is blocked.

**Issue forms**
- `bug.yml`: build version/channel (auto-filled from the bundle), what you did, expected vs actual, frequency, an upload field for the diagnostics zip and screenshots, and a checkbox "attached diagnostics bundle."
- `retest.yml`: issue #, pass/fail.
- `release-checklist.yml`: used by the agent.

**In-app "Report a problem"**
- Reachable from the gamepad menu and assignable to a button combo.
- It writes `~/…/reports/<timestamp>.zip` containing app logs (rotated, with tokens and server URLs redacted), the last N screenshots taken by the app's own capture, the app version, git SHA, channel, OS/kernel, gamescope and Mesa versions, the RomM server version from `/api/heartbeat` or equivalent (verify the endpoint), and a config dump with secrets removed.
- It then shows a **QR code** for a prefilled `https://github.com/<o>/<r>/issues/new?template=bug.yml&title=…&version=…` URL, which the tester scans on a phone to attach the zip.
- Prefilling issue-form fields through URL query parameters is an assumption to verify.
- Do **not** embed a GitHub token in a public app. A tiny relay, such as a serverless function holding a GitHub App credential, could upload bundles directly, but it adds infrastructure and an abuse surface.

**Install and update**
- One-liner for first install (run from Desktop Mode on the handheld): a `curl -fsSL https://raw.githubusercontent.com/<o>/<r>/main/install.sh | bash` script. It downloads the latest aarch64 AppImage from the GitHub Releases API, verifies SHA256, installs to `~/Applications`, and optionally adds a Steam non-Steam-game shortcut. The shortcut mechanics on armadaOS are out of my scope.
- After that, an in-app "Check for updates" with Stable/Nightly toggles calls `GET /repos/{o}/{r}/releases/latest` (stable) or lists releases including prereleases (nightly), then performs a zsync delta or full download with checksum verification, an atomic swap, and a restart.

**Per-release checklist**
- On `release.published` (nightly or stable), a routine creates a "Test checklist vX" issue. It is generated from `features.json` entries whose manual test steps changed since the last release, plus all `needs-retest` issues, as checkboxes.
- The tester ticks the boxes and comments only on failures. A failed box is converted to a `tester-report` issue by the agent.

**Automatic pickup**
- See section 2: Actions `issues.labeled` → routine `/fire`, plus a daily triage routine as a backstop.

### Gaps
- Not verified: whether GitHub issue forms accept per-field prefill through URL query parameters, and the behavior of `upload` fields on mobile browsers.
- armadaOS and Steam Game Mode specifics (shortcut creation, controller input to the browser for the QR flow) were not researched here; another researcher owns that scope.
- The RomM heartbeat or version endpoint name was not verified.

## 7. Risks and failure modes of long autonomous agent runs, and mitigations

### Takeaway
The documented failure modes are:
- declaring victory early or marking features done without e2e proof
- lenient self-evaluation
- scope creep and doing too much per session
- context degradation
- "green status ≠ success" for routines
- usage-limit stalls
- silent loss of background work when VMs are reclaimed
- broken builds pushed by an agent with branch-push freedom
- untestable hardware-specific UI

Most mitigations are structural: a feature list with acceptance criteria, one feature per run, required CI checks and rulesets, Stop-hook or `/goal` gates, a separate reviewer or evaluator, screenshot evidence, a label-gated human promotion to stable, and minimal-privilege routines.

### Cited Findings
- **Early victory and premature "done":** Claude tended to mark features complete after only unit tests or curl. Use a structured feature list, one feature per session, and e2e testing as a user would. — [Effective harnesses (Nov 2025)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- **Lenient self-grading:** agents "confidently praise the work," and an out-of-the-box QA agent talked itself into approval. Use a separate, skeptical evaluator. Full harnesses cost far more ($200 over 6 hr vs $9 over 20 min). — [Harness design (Mar 2026)](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- **Context anxiety:** Sonnet 4.5 wrapped up prematurely near the context limit, which resets fixed. Opus 4.5 largely removed the behavior. — [Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- **Context fill:** "performance degrades as it fills." Clear between tasks, and after two failed corrections start fresh. Over-long CLAUDE.md files get ignored. — [Best practices](https://code.claude.com/docs/en/best-practices)
- **Over-engineering from reviewers:** "A reviewer prompted to find gaps will usually report some… Chasing every finding leads to over-engineering." — [Best practices](https://code.claude.com/docs/en/best-practices)
- **Routine success is not task success:** a green run status only means no infrastructure error. — [Routines](https://code.claude.com/docs/en/routines)
- **Routines act as you:** they run without approval, connectors can write without asking, and pushes appear as the owner. Rulesets the owner can bypass don't block routine pushes. The GitHub proxy doesn't restrict which branches can be pushed. — [Routines](https://code.claude.com/docs/en/routines); [Cloud environments](https://code.claude.com/docs/en/cloud-environments)
- **Untrusted input:** API fire text is wrapped as untrusted. The GitHub Action requires write access for issue and PR triggers and rejects bot actors by default. — [Routines](https://code.claude.com/docs/en/routines); [GitHub Actions](https://code.claude.com/docs/en/github-actions)
- **Usage limits:** routine-started threads stop at the limit, while project threads wait and continue. Scheduled routines need usage credits to exceed the plan. — [Projects](https://code.claude.com/docs/en/claude-projects); [Routines](https://code.claude.com/docs/en/routines)
- **VM reclaim:** after reclaim, background subagents and shell commands are not restored. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- **Lapsed connections and schedules:** routines turn off after 72 h without a GitHub connection. Public-repo scheduled workflows are disabled after 60 days of inactivity. — [Routines](https://code.claude.com/docs/en/routines); [GitHub Actions](https://code.claude.com/docs/en/github-actions)
- **Auto-fix blind spots:** auto-fix can't see merge conflicts, and replies on PRs can trigger `issue_comment` automations. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

### Inferences
**Risk → mitigation table** (inferred from the cited findings)

| Risk | Mitigation |
| --- | --- |
| Scope creep | `features.json` with acceptance criteria and an explicit out-of-scope list in ROADMAP; one feature or issue per run; routine prompts say "pick exactly one item; if none is `ready-for-agent`, triage only and stop"; reviewer subagent checks "nothing outside the task's scope changed." |
| Broken main | Ruleset on `main` requiring PR + green `ci/*` checks (x86_64 and arm64) with no bypass; Stop hook running `scripts/check.sh`; nightly built only from green main; agent-created branches limited to `claude/*` by convention plus rulesets. |
| Untestable UI on real hardware | App-internal deterministic screenshot capture plus golden-image tests under Xvfb, attached to PRs as evidence; a `--fake-gamepad` input-script mode for navigation tests; label `needs-device-test` on any PR touching input or gamescope integration; promotion to stable requires `tester-verified`. |
| aarch64-only bugs (e.g. native libs, emulator launch paths) | Run the full test matrix on `ubuntu-24.04-arm`. The tester's checklist covers device-only behavior: suspend/resume, gamescope focus, controller mapping, emulator handoff. |
| RomM API drift | Pinned spec snapshot, a scheduled drift check, and integration tests against a pinned RomM image, bumped deliberately via ADR. |
| Prompt injection via public issues | Agent acts only on maintainer- or tester-applied labels; minimal connectors; no secrets in environment variables; network secrets only where needed; no CI/workflow edits without `needs-human`. |
| Quota exhaustion and stalls | Daily (not hourly) roadmap routine; event-driven fires for tester reports; Sonnet for routine triage and Opus for hard fixes (model selectable per routine); check `/usage` and consider usage credits for spikes. |
| Silent failures | Each run appends to `PROGRESS.md` with its session URL; a weekly routine posts a status summary issue or comment; the maintainer skims run transcripts, since green ≠ success. |
| Lost work on VM reclaim | Commit and push early and often (per Anthropic's harness guidance); never rely on long background jobs; idempotent `init.sh`. |

### Gaps
- No primary-source data was found on failure rates of multi-day routine-driven projects specifically. The evidence is from Anthropic's harness experiments, which were single multi-hour runs.
- No source covers testing gamescope/Steam Game Mode integration in CI. The headless gamescope backend has a reported rendering issue (#1984), so device testing by the human remains necessary for that layer.
