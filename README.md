# ezz-mods

One Claude Code mod, `command-center`: what each session is on, at a glance, in every project. Inside ims-nawy it also knows the worktrees, the environment and the repo's rules.

## What you see

**The bar** above the message box, and nothing else there:
- Line 1: the Jira ticket, its status and title, the worktree, which database it uses (or "tunnel down"), and progress (the story's requirements done).
- One line per branch (frontend and backend in ims-nawy): branch name, commits on it, unpushed, uncommitted, and the PR's state (approved, changes requested, conflicts, new comments…).
- Context, tokens and cost on the right.
- **One button, "Open ▸"**, for the side panel.

**The side panel**: one panel, with tabs:
- **Overview**: context, tokens, cost, time and the session's goal with its steps, then one compact row per tab (Jira, each branch, agents, files, sessions, skills); › opens that tab.
- **GitHub**: per branch, a diagram like GitHub Desktop's (main, the branch from where it forked with a dot per commit, main's new commits since, staging and the PR into it), the branch's commits (this session's and unpushed ones marked), then the PR: review, comments, checks, conflicts and the deploy after merging.
- **Jira**: status, the requirements checklist, bugs, code review and testing sub-tasks, the latest comment; an error says why, with Retry.
- **Agents**: each subagent, its type and model, tools, tokens, context, time.
- **Files**: what Claude is doing right now, and every file touched, with lines added/removed and "used by N".
- **Sessions**: the other sessions open in this folder: what each is on, working, idle or needing you, context and cost.
- **Skills & plugins**: skills and slash commands this session used, this project's skills, the plugins on (for this project or everywhere) with their commands, your global skills.
- **Vercel**: deployments of this branch, when there are any.
- **Controls**: switches for What you should know, Next actions, Replay and Reflect.

**After each task**, under Claude's reply, each its own card:
- **You should know**: risks, side effects, assumptions, decisions left to you.
- **Replay**: the edits of that task; opens them in the panel one diff at a time, Previous/Next always in view.
- **What's next**: up to three likely next prompts, each with a **Use** button that puts it in the prompt box (nothing is sent).

**Reflect**: when you correct Claude, a card under the reply offers to save it as a rule, for this project (its CLAUDE.md) or for all projects (~/.claude/CLAUDE.md).

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
