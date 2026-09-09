# pi-config

My public [pi](https://github.com/earendil-works/pi) configuration.

## Install

```sh
gh repo clone zi3t/pi-config ~/.pi/agent
but skill install --global
pi
```

Pi installs the packages listed in `settings.json` on startup. Authenticate providers separately with `/login`.

Only shareable configuration is tracked. Credentials (`auth.json`), trust decisions, sessions, memory, missions, worktrees, package installs, caches, and other runtime state are ignored.
