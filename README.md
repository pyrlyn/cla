# pyrlyn/cla

A GitHub Action that checks the pyrlyn Contributor License Agreement on pull requests. It replaces CLA Assistant Lite (`contributor-assistant/github-action`, archived) in the reusable `cla` workflow of [`pyrlyn/ci`](https://github.com/pyrlyn/ci).

One signature covers every pyrlyn repository. Signatures are appended to `signatures/cla.json` in `pyrlyn/cla-signatures`. The pull request decision is the commit status **`pyrlyn/cla`**, not the job result: a green job with a failing status means someone still has to sign, and a red job means the action itself broke and no status was set.

- [`PLAN.md`](PLAN.md) — design (English, source of truth)
- [`docs/ru/PLAN.md`](docs/ru/PLAN.md) — Russian translation
- [`docs/uk/PLAN.md`](docs/uk/PLAN.md) — Ukrainian translation

The agreement text lives in `pyrlyn/ci`: [`CLA.md`](https://github.com/pyrlyn/ci/blob/main/CLA.md) and [`CLA.ru.md`](https://github.com/pyrlyn/ci/blob/main/CLA.ru.md).

## Usage

Pin a full commit SHA. The job token reads the pull request, posts one sticky comment, sets the status, and locks the conversation after merge. `cla-token` is a GitHub App token or a fine-grained PAT that can read organization members and read and write `pyrlyn/cla-signatures`.

```yaml
name: cla
on:
  pull_request_target:
    types: [opened, synchronize, reopened, closed]
  issue_comment:
    types: [created]
permissions:
  contents: read
  pull-requests: write
  statuses: write
concurrency:
  group: cla-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: false
jobs:
  cla:
    if: >-
      vars.CLA_ENABLED == 'true' &&
      (github.event_name == 'pull_request_target' ||
       (github.event.issue.pull_request &&
        (github.event.comment.body == 'recheck' ||
         contains(github.event.comment.body, 'I have read the CLA Document and I hereby sign the CLA'))))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        id: app
        with:
          app-id: ${{ secrets.CLA_APP_ID }}
          private-key: ${{ secrets.CLA_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: cla-signatures
          permission-members: read
          permission-contents: write
      - uses: pyrlyn/cla@<sha> # v1.0.0
        with:
          cla-token: ${{ steps.app.outputs.token }}
          document-url: https://github.com/pyrlyn/ci/blob/<sha>/CLA.md
          document-url-ru: https://github.com/pyrlyn/ci/blob/<sha>/CLA.ru.md
          cla-version: "1.0"
          document-sha256: "<sha256 of CLA.md>"
          minimum-version: "1.0"
```

A fine-grained PAT with the same access can be passed as `cla-token` instead of the app token. The app itself needs Organization **Members: read** and repository **Contents: read and write**, installed on `cla-signatures` only.

Run the workflow on `issue_comment` only when the comment is on a pull request and the body is `recheck` or contains the sign phrase. Do not check out the pull request and do not put event text in a `run:` script. `pull_request_target` runs from the base branch with a write token; this action only calls the GitHub API.

A contributor signs by posting this as a new comment, alone:

```text
I have read the CLA Document and I hereby sign the CLA
```

`recheck` runs the check again. The status is written on the pull request head commit, including from a comment event, so the workflow does not re-run itself.

## What is covered

A person is covered when they are a current member of `pyrlyn` (`members-pass`), an allowlisted bot matched by login and numeric id, or they signed at least `minimum-version`. The check includes the opener, every commit author, every commit committer other than `web-flow`, and every `Co-authored-by` trailer. An author email with no GitHub account stays failing until the email is linked or the commits are rewritten.

If the opener is not an author or co-author of any commit, the check fails unless the opener is an organization member.

## Permissions

| Permission | Access | Why |
| --- | --- | --- |
| `contents` | read | Read the pull request through the API |
| `pull-requests` | write | Sticky comment, lock after merge, unlock on reopen |
| `statuses` | write | Commit status `pyrlyn/cla` |

## Release

Releases are cut from `main` only. Tag a signed annotated `v1.0.0` (and the moving `v1` convenience tag, if you want one). The release workflow publishes the GitHub release when that tag points at `main`.

## Development

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

`dist/index.js` is the file GitHub runs. CI fails when the bundle is stale.

## License

Apache-2.0. Ported phrase matching and `Co-authored-by` parsing are attributed in [`NOTICE`](NOTICE).
