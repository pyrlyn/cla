# pyrlyn/cla

If an `AGENTS.md` or `CLAUDE.md` exists higher in the tree, follow it too. On conflict, ask the creator.

`PLAN.md` is the design. The task tracker `plan.md` is not a second file: this volume is case-insensitive, so that name is the design document.

The action runs on `pull_request_target`. It reads pull request data through the GitHub API only. Do not check out pull request code or interpolate event text into a `run:` script.

## Commands

jactionlint and hk are pinned in `mise.toml`. `.github/jactionlint.yaml` applies the default profile and the
baseline `.github/jactionlint-baseline.json`. `hk.pkl` runs jactionlint as a pre-push hook:

```bash
mise x -- jactionlint                  # lint workflows, composite actions, dependabot.yml
mise x -- jactionlint --baseline-write # refresh the baseline after fixing findings
mise x -- hk install --mise            # install the pre-push hook once per clone
```
