# ezz-mods

Two Claude Code mods (plugins of function hooks) that turn a session into a development command center.

| Pack | Loads in | What it adds |
|---|---|---|
| `command-center` | every project (user scope) | status band, next steps, the `/cc` pane (Now · Sessions · PRs · Files · Impact), guard, turn receipt, desktop tool icons, `/standup` |
| `ims` | ims-nawy only (project scope) | IMS rules enforced on every command, tunnels/Redis/DB line, `/ims` pane (Stories · Worktrees · Checklist · UAT), Jira tickets into context, `requirements` and `uat_log` tools |

## Install

Folder marketplace, so edits here go live with `/reload-plugins` (no reinstall):

```bash
claude plugin marketplace add ~/Main/Personal/coding-projects/claude-mods/code
claude plugin install command-center@ezz-mods --scope user
cd ~/Main/Nawy/coding-projects/ims-nawy && claude plugin install ims@ezz-mods --scope project
```

From GitHub once pushed: `/plugin install command-center --marketplace ezzhassan97/claude-mods`.

## command-center

**Band** (above the prompt, one line): `✻ branch ↑ahead ↓behind ±dirty · ctx ▰▰▱ 34% · $1.20 · ☑ 3/7 · ◐ 2 agents · PRs 3 ▲1 · ◆ 1 waiting  cc ▸`.
After an answer, up to three **next steps** (press 1–3 to put one in the prompt box; Tab takes the first).

**`/cc [now|sessions|prs|files|impact|refresh|skin on|off]`** opens the pane:

- **Now** — project and branch, context/spend/limit meters, the task list, subagents (status, tools, tokens, time), what the guard held.
- **Sessions** — every Claude Code session on this machine, any project: who needs you, who is working, cost and context of each.
- **PRs** — every open PR (and merged this week) across all `gh` accounts: review state, new comments, commits someone else pushed, drift vs base and main, conflicts (and which files), checks, the deploy after a merge.
- **Files** — what this session touched (read / edited / created, +/− lines, git status), or the full tree.
- **Impact** — for each edited file, who imports it and from which modules; "measure branch" for a whole branch; "copy for PR" for the reviewer notes.

**Guard** — force-push, hard reset, discard, git clean, branch delete, PR merge, rm -rf and destructive SQL wait for your answer in the native dialog, with what they would change. `rm -rf ~` and force-pushing main are refused.

**Receipt** — one line under a working turn: `✻ 42s · 12 tools · 4 files +120 −30 · $0.31`.

**`/standup [days]`** — commits across every repo in `~/Main`, PRs, and live sessions.

Options (`/config` → command-center): budget, context warning, chime, and each feature on/off.

## ims

- **Rules**: PRs only into `staging` with `mazenfayez` as the only reviewer and a complete description; never merge, never merge `staging` in, never push shared branches, never switch the shared `frontend/`/`backend/` checkouts, GitHub calls carry the nawy token, MySQL schema changes ask first and say whether they hit staging or local.
- **Band line**: `IMS · MySQL ● Mongo ● Redis ● · db staging · ◐ 2 running` with a fix button when a tunnel drops.
- **`/ims [stories|worktrees|checklist|uat|refresh|story IMS-n|tunnels]`**.
- **Tickets in context**: mention `IMS-2423` and the story is loaded for Claude once.
- **Checklist / UAT**: the story's Requirements become a checklist Claude ticks via `requirements`; `/ims-end` is told what is open. During `/uat-start` verdicts are logged via `uat_log`; `/uat-end` gets the board.

## Develop

```bash
CC="$HOME/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude"
"$CC" plugin validate command-center && "$CC" plugin test command-center
"$CC" plugin validate ims && "$CC" plugin test ims
npx -p typescript@5.6.3 tsc -p tsconfig.json
```

Engine rules that shape the code: `$` is used only in `hooks/register.tsx` (the engine follows `$` within one file), which builds an `io` door for features and views; state atoms are declared there too; each event has one unfiltered hook per module.
