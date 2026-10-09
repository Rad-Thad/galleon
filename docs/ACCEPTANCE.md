# Galleon acceptance session

<!-- Written by scripts/agent/acceptance.mjs from docs/features.json, docs/acceptance-plan.json and docs/PROGRESS.md. Edit those, then run it again. -->

Build: **Galleon 0.20.0**. Settings → About shows this version; if it shows another, stop and tell the local Claude session.

About 15 minutes in all, never more than two hours. The local Claude session on the Mac reads each step to you, does every terminal and GitHub step, and fills in the results table at the end. You hold the Nova (and your phone where a step says so) and say what you see.

### Back up the saves first (about 10 min)

The local Claude session copies the server's saves for the games this session uses to the Mac, by reading only (GET). Nothing is written to the server. You do nothing but wait for it to say the copy is complete.

No feature is ready for the session yet. Items appear here as their code is merged.

### Record the results (about 5 min)

The local Claude session reads the table below back to you, writes `acceptance/<date>/results.json` (schema in docs/TESTING.md, "The acceptance session") and pushes it to the `device-results` branch.

## Results

Result is pass, fail or skip. Notes are in your words, with no addresses or account names.

| Feature | Item | Result | Notes |
| ------- | ---- | ------ | ----- |
