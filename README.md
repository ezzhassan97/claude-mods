# ezz-mods

One Claude Code mod, `command-center`: what each session is on, at a glance, in every project. Inside ims-nawy it also knows the worktrees, the environment and the repo's rules.

## What you see

**The bar** above the message box:
- Line 1: the Jira ticket, its status and title, the worktree, which database it uses (or "tunnel down"), and progress (the story's requirements done).
- One line per branch (frontend and backend in ims-nawy): branch name, commits on it, unpushed, uncommitted, and the PR's state (approved, changes requested, conflicts, new comments…).
- Context, tokens and cost on the right.
- **One button, "Open ▸"**, for the side panel.

**The side panel**: one panel, with sections that fold:
- **Overview**: context, tokens, cost and time; the ticket; each branch with its last commit; the worktree, its ports, the tunnels and the database; other sessions and which need you; "change worktree" when the guess is wrong.
- **Agents**: each subagent, its type and model, tools, tokens, context, time.
- **Files**: what Claude is doing right now, and every file touched, with lines added/removed and "used by N" (how many files import it).
- **GitHub**: this session's PRs, with review state, comments, commits someone else pushed, how far behind the base and main, checks, conflicts (and which files), and the deploy after a merge. Your other PRs are folded underneath.
- **Jira**: status, the requirements checklist, bugs, code review and testing sub-tasks, the latest comment.
- **Vercel**: deployments of this branch, when there are any.
- **Controls**: switches for Next actions, What you should know, Replay, Reflect and the card after each task. They're remembered across sessions.

**After each task**, a card shows:
- how long it took, the tools used, lines changed and cost;
- **what you should know**: risks, side effects, assumptions, decisions left to you;
- **Replay**: step through each edit as a diff, in the panel;
- up to three **next actions** (press 1–3 to put one in the prompt box).

**Reflect**: when you correct Claude, a card offers to save it as a rule, for this project (its CLAUDE.md) or for all projects (~/.claude/CLAUDE.md).

## Install

Installed from this folder, so edits go live with `/reload-plugins`:

```bash
claude plugin marketplace add ~/Main/Personal/coding-projects/claude-mods/code
claude plugin install command-center@ezz-mods --scope user
```

Jira lookups from the mod go through your permission rules (a mod can't approve its own calls). To allow the two read-only Jira lookups, add them to `permissions.allow` in `~/.claude/settings.json`.

## Develop

```bash
npx -y tsx dev/preview.ts && dev/shot.sh /tmp/shots          # every drawing, sample data, light + dark screenshots
npx -y tsx dev/probe.ts <ims-root> <transcript.jsonl> [jira.json]   # the real features on real repos and GitHub
CC="$HOME/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude"
"$CC" plugin validate command-center && "$CC" plugin test command-center
npx -p typescript@5.6.3 tsc -p tsconfig.json                  # needs .types/claude-code.d.ts (the engine's API file)
```

Engine rules that shape the code:
- `$` is used only in `hooks/register.tsx`, because the engine follows `$` within one file. That file builds the `io` door that features and views use.
- State atoms are declared there too.
- Each event has one hook without a matcher.
- Desktop lines are each drawn as one SVG, because separate elements wrap.
- A mod can't approve its own tool calls.
