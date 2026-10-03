# pyrlyn/cla

If an `AGENTS.md` or `CLAUDE.md` exists higher in the tree, follow it too. On conflict, ask the creator.

`PLAN.md` is the design. The task tracker `plan.md` is not a second file: this volume is case-insensitive, so that name is the design document.

The action runs on `pull_request_target`. It reads pull request data through the GitHub API only. Do not check out pull request code or interpolate event text into a `run:` script.
