# pi-config

My public [pi](https://github.com/earendil-works/pi) configuration.

## Install

```sh
gh repo clone zi3t/pi-config ~/.pi/agent
pi
```

Pi installs the packages listed in `settings.json` on startup. Authenticate providers separately with `/login`.

## Skills and context

Pi loads project `AGENTS.md`, trusted `.agents/skills`, and `.pi/prompts` directly.
Do not copy them into this personal setup or import the entire Codex skill catalog.
Codex settings and plugin toggles do not configure Pi.

Keep package resource filters in `settings.json`, not edits to installed package
files. The MCP scripting guide is enabled as `/skill:mcp-scripting`; its upstream
`disable-model-invocation` flag keeps it out of the always-loaded skill catalog.
`@narumitw/pi-worktree` provides the guarded `/worktree` manager for isolated
branches and Pi session switching. Managed worktrees default outside repositories
under `~/.worktrees`.

After configuration changes, restart Pi to check discovery. Use `/model` and
`/thinking` for session choices; Ctrl+S in either picker saves its startup default.

## Local extensions

- `tgrep_search` provides bounded worktree-aware regex, literal, files-only, and multiline search through Microsoft `tgrep`; use `fresh=true` after edits or for exhaustive checks.
- `/tgrep-status` reports index state and `/tgrep-reindex` rebuilds the external per-worktree cache.
- `/learn on|off` toggles strict tutoring mode; new sessions default to on only in the `hustler` repository.

Edit files under `extensions/`, then run `/reload`.

Only shareable configuration is tracked. Credentials (`auth.json`), trust decisions, sessions, memory, missions, worktrees, package installs, caches, and other runtime state are ignored.
