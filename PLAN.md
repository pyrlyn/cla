# pyrlyn/cla: plan

Status: plan, nothing implemented yet. Written 2026-10-03.
This English file is the source of truth. Translations: [Russian](docs/ru/PLAN.md),
[Ukrainian](docs/uk/PLAN.md). If a translation differs, this file prevails.

`pyrlyn/cla` will be a small GitHub Action, owned by the organization, that checks the pyrlyn
Contributor License Agreement on pull requests. It replaces CLA Assistant Lite
(`contributor-assistant/github-action`), which `pyrlyn/infra` wraps today and which was archived on
2026-03-23.

## 0. Goals and non-goals

Goals:

1. Every person whose work is in a pull request is covered: they signed the current CLA version,
   they are a member of the `pyrlyn` organization, or they are an allowlisted bot.
2. Signing stays a pull request comment with a fixed phrase, as `CLA.md` section 11 describes.
3. One signature covers all pyrlyn repositories. Signatures live in a repository we own.
4. A clear, stable, required check that rulesets can use, and one bot comment that says exactly
   what is missing and how to fix it.
5. CLA versions: a new version can require signing again.
6. Safe on `pull_request_target`: no pull request code is ever checked out or run.

Non-goals: a web UI or "Sign in with GitHub" page, corporate CLAs (a company signing for its
employees; handled by contacting the Licensor, `CLA.md` 11.4), DCO sign-off, other forges.

## 1. What exists today (study)

Two code bases were read for this plan:

- **Upstream** `contributor-assistant/github-action`, archived, last commit `58daaf8`
  (2026-03-23). `pyrlyn/infra` pins tag `v2.6.1` = `ca4a40a7d1004f18d9960b404b97e5f30a505a08`.
  Apache-2.0.
- **Fork** `iainmcgin/cla-github-action`, `v3.2.0` = `0d27e5a16278d4adb6b0c4b92f08ad27b0a21dc8`
  (2026-06-17). Apache-2.0. Diverges at `58daaf8`; see its `CHANGELOG.md`.

### 1.1 Signature flow

- Entry point `src/main.ts`: on `closed` it only locks the pull request (`lockPullRequest()`);
  otherwise `setupClaCheck()`.
- `src/setupClaCheck.ts`: collects committers, removes allowlisted ones, reads the signatures
  file, splits committers into `signed` / `notSigned` / `unknown` (no GitHub account), updates the
  bot comment, writes new signatures, then either fails the job or re-runs the last failed run.
- `src/graphql.ts`: committers come from the GraphQL `pullRequest.commits` query, taking
  `author.user` or else `committer.user` of every commit. User `41898282` (`github-actions[bot]`)
  is always dropped. Upstream reads only the first 100 commits (no pagination).
- `src/pullrequest/signatureComment.ts`: lists the pull request comments and treats a comment as a
  signature when it matches the phrase. Upstream uses a loose regex `^.*i have read the cla
  document and i hereby sign the cla.*$` on the lower-cased body; it reads only the first 30
  comments (no pagination). The record kept for each signer is `name`, `id`, `comment_id`,
  `created_at`, `repoId`, `pullRequestNo`. Comments by `github-actions[bot]` never count.
- `src/shared/pr-sign-comment.ts`: default phrase
  `I have read the CLA Document and I hereby sign the CLA` (input `custom-pr-sign-comment`).
- `src/pullrequest/pullRequestComment.ts` + `pullRequestCommentContent.ts`: one bot comment is
  created and then edited in place, with the list of unsigned committers and the phrase to post.
- Recheck: the caller workflow filters `issue_comment` events so that only `recheck` or the phrase
  start a run.
- `src/pullRerunRunner.ts`: the comment run happens on `issue_comment`, so its result is not
  attached to the pull request head. The action therefore finds its own workflow **by name**
  (`context.workflow`), lists `pull_request_target` runs on the head branch, and re-runs the
  latest one if it failed. This needs `actions: write`, breaks when two workflows share a name
  ("Unable to locate this workflow's ID"), and matches the head branch by name only (a fork branch
  named `main` can match other runs).

### 1.2 Storage

- `src/persistence/persistence.ts`: one JSON file, `{"signedContributors": [...]}`, read and
  written through the contents API (`repos.getContent` / `createOrUpdateFileContents`) on input
  `branch` at `path-to-signatures`.
- Same repository: uses `GITHUB_TOKEN`, so the job needs `contents: write` and the branch must not
  be protected. Remote repository (`remote-organization-name` / `remote-repository-name`): uses
  `PERSONAL_ACCESS_TOKEN` (`src/octokit.ts`); without it the run fails with "Please add a personal
  access token".
- Writes use the file `sha` from the read; two signatures at the same moment conflict and one run
  fails ("Could not update the JSON file"). There is no retry.
- Upstream bug: `src/setupClaCheck.ts` compares `error.status === "404"` (a string) with a numeric
  status, so the "create the file on first run" branch never runs. With `v2.6.1` a missing
  `cla.json` ends in "Could not retrieve repository contents. Status: 404". The fork fixed it
  (`c5254b2`). `pyrlyn/infra` `docs/cla.md` currently says the action creates the file; with the
  pinned version that is not true.

### 1.3 Check logic

- Result = the job result: `core.setFailed()` makes the workflow job red. Nothing calls the
  statuses API, although the documented permissions include `statuses: write`.
- Allowlist (`src/checkAllowList.ts`): comma-separated logins, `*` wildcard turned into a regex.
  Upstream checks the login only; the fork also checks the commit email (`73f6929`).
- Pull request lock (`src/pullrequest/pullRequestLock.ts`): after `closed` the conversation is
  locked so signature comments cannot be edited. Upstream locks on **any** close, also unmerged; a
  reopened pull request then cannot get a bot comment. Fixed in the fork `v3.1.0` (`30dab6b`): lock
  only when merged, unlock on `reopened`.
- Identity: git author fields are not authenticated. Anyone can author commits with somebody
  else's email (for example an allowlisted bot or a signed contributor); GitHub maps the email to
  that account and upstream counts that account. The fork's `v3.0.0` adds the pull request opener
  and `Co-authored-by:` trailers to the committer set (`src/shared/coAuthors.ts`) and fails when
  the opener is not an author of any commit (`require-opener-as-author`, default `true`).
- Fork `v3.2.0` (`1f440bd`): the phrase must be on its own line, case-insensitive, trailing `.`/`!`
  ignored, quoted (`>`) lines never count, little extra text allowed.
- Runtime: upstream `action.yml` declares `node20`; the fork declares `node24`. GitHub runs
  JavaScript actions on Node 24 since 2026-09-23.

### 1.4 `pull_request_target` security

Both projects document `pull_request_target` + `issue_comment`. `pull_request_target` runs the
workflow from the **base** branch with a write token and secrets, also for fork pull requests.
This is safe only while the workflow never checks out or executes code from the pull request and
never interpolates attacker-controlled text (titles, bodies, comments, branch names) into `run:`
scripts. Neither action checks out code; both read pull request data only through the API.

### 1.5 What we reuse

| Idea | Source | Decision |
| --- | --- | --- |
| Sign by PR comment, sticky bot comment, `recheck` | upstream | keep |
| Remote JSON in a private repository | upstream | keep, new schema |
| Pagination of commits and comments | fork `cac6d84` | required |
| Opener + `Co-authored-by` as committers, impersonation guard | fork `v3.0.0` | required |
| Strict phrase on its own line, no quotes | fork `v3.2.0` | required |
| Lock only merged, unlock on reopen | fork `v3.1.0` | required |
| Retry on 5xx (`@octokit/plugin-retry`) | fork `5b54183` | required; also retry the 409 write conflict |
| Find own workflow by name and re-run it | upstream `pullRerunRunner.ts` | **drop**, use a commit status |

The code will be new and small (TypeScript). Where a function is ported from either project
(Apache-2.0), the file keeps a header naming the source and the repository gets a `NOTICE`. The
license of `pyrlyn/cla` itself: Apache-2.0 (decision for Ivan; it keeps porting simple).

## 2. pyrlyn requirements

### 2.1 Who is covered

A person is covered when any of these is true, checked in this order:

1. **Organization member** of `pyrlyn` (auto-pass, no signature). Input `members-pass: true`.
2. **Allowlisted bot**, matched by numeric user ID and login, never by email.
3. **Signed** the CLA version that is currently required.

People checked: the pull request opener, every commit author, every commit committer that is a
GitHub user other than `web-flow` (ID `19864447`), and every `Co-authored-by:` trailer. An author
email not linked to a GitHub account is "unknown": it cannot sign, the check stays red, and the
comment explains how to link the email or rewrite the commits.

Impersonation guard (from the fork): if the opener is not an author or co-author of any commit,
the check fails unless the opener is a member. An outsider therefore cannot pass by attributing
commits to an allowlisted bot or to someone who signed.

Legal note for Ivan: today the only member is `listepo` (the copyright holder). A future member who
is not Ivan contributes without a signature. Either members sign a separate agreement, or set
`members-pass: false`. Membership is evaluated at check time and not stored.

### 2.2 Membership check

`GITHUB_TOKEN` cannot see private organization membership: it is an installation token without
the organization "Members" permission. `GET /orgs/pyrlyn/members/{user}` then reports private
members as non-members. Today `listepo` is a private member (`/orgs/pyrlyn/public_members` is
empty). `author_association` in the event payload is not a reliable membership signal either.

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| A. **GitHub App** `pyrlyn-cla` (recommended) | org app, Organization permission **Members: read**, Repository permission **Contents: read and write**, installed on `pyrlyn/cla-signatures` only; token minted per run with `actions/create-github-app-token` | one credential for membership and storage; no expiry; scoped to one repository; bot identity on signature commits | create and install an app; two secrets (`CLA_APP_ID`, `CLA_APP_PRIVATE_KEY`) |
| B. Public membership | each member makes membership public; check `GET /orgs/pyrlyn/public_members/{user}` with `GITHUB_TOKEN` | no secret for this part | depends on every member; a member who hides membership is asked to sign |
| C. Organization PAT | fine-grained PAT, resource owner `pyrlyn`, Organization **Members: read** (+ Contents on `cla-signatures`) | quick | tied to Ivan's account, expires, must be rotated |
| D. Static list | members listed in `allowlist` | no API call | goes stale; same as allowlist |

Plan: implement A, support C with the same input (any token with that access), keep B as a
fallback when no token is given. If membership cannot be read (403 / no token), the person is
treated as a non-member and the comment says that membership could not be verified. The check
never passes silently on an error.

### 2.3 Bots allowlist

Default list, by login with the numeric ID resolved at run time and compared:

- `dependabot[bot]` (`49699333`), `github-actions[bot]` (`41898282`), `renovate[bot]`.
- The bot of the `pyrlyn-cla` app and any other pyrlyn app added later.

Wildcards are allowed only for logins ending in `[bot]` and must be configured explicitly. Bots
do not sign. A bot is covered only as a commit author; an allowlisted bot as opener with
outside authors does not cover those authors.

### 2.4 CLA text and versions

- Text: `pyrlyn/infra` `CLA.md` "Version 1.0 (draft)" (English, canonical) and `CLA.ru.md`
  (Russian translation). Section 11 describes signing with the phrase
  `I have read the CLA Document and I hereby sign the CLA`, the data recorded (login, numeric ID,
  comment ID and time, repository and pull request) and that one signature covers all projects.
  Section 12.2: a new version applies to contributions after the contributor accepts it.
- Before go-live, `CLA.md` 11.1 and `CLA.ru.md` 11.1 should stop naming "CLA Assistant Lite"
  ("an automated check" is enough). The text is still a draft, so this needs no new version.
  Optional: a Ukrainian translation `CLA.uk.md` (none exists).
- Version inputs: `cla-version` (for example `1.0`), `document-url` pinned to a commit of
  `pyrlyn/infra` (`.../blob/<sha>/CLA.md`), and `document-sha256` (SHA-256 of that file). The
  action stores all three with every signature.
- Re-sign: input `minimum-version`. A signature with a lower version does not cover the person;
  the comment says "you signed version X, version Y is now required" with a link to the new text.
  Raising `minimum-version` is a deliberate step. A new version alone (12.2) does not make old
  signatures invalid for old contributions.
- The phrase stays as in 11.1. The version is the one linked in the bot comment at the time of
  signing (11.2 "the version linked in the check's message").

### 2.5 Pull request messages

One sticky comment, found by a hidden marker `<!-- pyrlyn-cla -->`, created once and then edited.
English, with links to `CLA.md` and `CLA.ru.md`. It contains:

- A table of everyone checked: login, reason (member / bot / signed v1.0 on date / missing /
  unknown email / outdated version).
- The exact phrase in a code block and "post it as a new comment, alone".
- `recheck` hint; unlinked-email instructions; the impersonation warning when it applies.
- When everybody is covered: one short line, with no `@` mentions.

Commit status (context `pyrlyn/cla`), `description` up to 140 characters:

- `success`: `All 3 contributors covered (1 member, 1 bot, 1 signed CLA 1.0)`
- `failure`: `CLA 1.0 signature missing: @alice, @bob. See the pull request comment.`
- `failure`: `Unknown commit email (not linked to GitHub): 1. See the comment.`
- `failure`: `PR opener @mallory is not an author of any commit.`
- `error`: `CLA check could not read signatures (HTTP 403). Maintainers: see the run log.`

`target_url` points to the bot comment. The job writes a step summary with the same table.

## 3. Structure

### 3.1 Repository layout

```
action.yml            name, inputs, outputs; runs.using: node24, main: dist/index.js
src/main.ts           event routing: pull_request_target, issue_comment, closed, reopened
src/config.ts         inputs, validation (fail fast on bad config)
src/people.ts         opener, authors, committers, Co-authored-by (paginated GraphQL)
src/membership.ts     org membership with cache per run
src/allowlist.ts      bots by ID and login
src/signing.ts        phrase matching (strict, own line, no quotes)
src/store.ts          signatures file: read, append, write with retry on 409
src/report.ts         sticky comment, commit status, step summary
src/lock.ts           lock after merge, unlock on reopen
tests/unit/           vitest, one file per module
tests/integration/    whole runs against a fake GitHub (recorded payloads, msw)
dist/index.js         bundle (ncc or esbuild), committed; CI fails if it is stale
.github/workflows/    ci.yml (lint, typecheck, test, dist check), release.yml
NOTICE, LICENSE, README.md, PLAN.md, docs/ru, docs/uk
```

Node 24, TypeScript, `@actions/core`, `@actions/github`, `@octokit/plugin-retry`. No runtime
network access other than the GitHub API.

### 3.2 Inputs (first version)

`github-token` (default `github.token`; comment, status, lock), `cla-token` (signatures +
membership; app token or PAT), `org` (`pyrlyn`), `members-pass` (`true`), `allowlist`,
`signatures-repository` (`pyrlyn/cla-signatures`), `signatures-branch` (`main`),
`signatures-path` (`signatures/cla.json`), `document-url`, `document-url-ru`, `cla-version`,
`document-sha256`, `minimum-version`, `sign-phrase`, `status-context` (`pyrlyn/cla`),
`lock-after-merge` (`true`), `require-opener-as-author` (`true`).
Outputs: `covered` (`true`/`false`), `missing` (JSON list of logins).

### 3.3 Signatures file

```json
{
  "schema": 1,
  "signatures": [
    {
      "user": "alice", "user_id": 123,
      "cla_version": "1.0", "document_sha256": "…",
      "signed_at": "2026-10-10T12:00:00Z",
      "comment_id": 456, "comment_url": "https://github.com/pyrlyn/cox/pull/1#issuecomment-456",
      "repository": "pyrlyn/cox", "repository_id": 789, "pull_request": 1
    }
  ]
}
```

Append only; matching is by `user_id`, never by login (logins can be renamed). The writer reads,
appends, writes with the read `sha`, and on 409 re-reads and retries (up to 5 times). A missing
file is created. No signatures exist yet, so no migration of the Lite format is needed.

### 3.4 Storage: separate repository vs branch

| | `pyrlyn/cla-signatures` (private) | branch in the same repository |
| --- | --- | --- |
| Token | write on one private repository | `contents: write` on the code repository |
| History | separate, no noise in code pins | signature commits in every repository |
| One signature for all repositories | yes | no (one file per repository) |
| Protection | `main` unprotected there only | an unprotected branch in each code repository |

Decision: `pyrlyn/cla-signatures`. It already exists (private, created 2026-10-02) and is
**empty**: GitHub answers 409 "Git Repository is empty", so it needs a first commit (README)
before the contents API can write to it. Back it up (for example a weekly `git clone --mirror`).

### 3.5 Events and the reusable workflow

The action stays a step inside the existing reusable workflow `pyrlyn/infra`
`.github/workflows/cla.yml`; callers keep their thin `cla.yml`:

- `pull_request_target`: `opened`, `synchronize`, `reopened`, `closed`.
- `issue_comment`: `created` on pull requests only, when the body contains the phrase or is
  `recheck`.
- The comment run sets the commit status on the pull request **head SHA** itself. This removes the
  re-run logic, `actions: write` and the "workflow name must be unique" rule.
- Concurrency: `group: cla-${{ github.event.pull_request.number || github.event.issue.number }}`,
  `cancel-in-progress: false`.
- Never `actions/checkout`, never run `npm`/scripts from the pull request, no `${{ … }}` of event
  text inside `run:`. The action only calls the API.
- The off switch `vars.CLA_ENABLED == 'true'` stays.

The job is green when the action worked; the decision is the commit status. A red job means the
action itself failed, and then no status is set, so a required check blocks (fail closed).

### 3.6 Required check name

The rulesets require the status context **`pyrlyn/cla`** (not the job name `cla / cla`). It is
set by the `github-actions` app; the ruleset may pin that source (integration ID `15368`).

### 3.7 Releases and pinning

- Semantic versions `v1.0.0`, …, signed annotated tags, GitHub releases with notes. A moving `v1`
  tag is a convenience only.
- Consumers pin a full commit SHA with a `# v1.0.0` comment (as `pyrlyn/infra` does today for
  every action; `infra` `action-pins.yml` checks it).
- CI on every PR: lint, typecheck, tests, dist up to date. Release only from `main`.
- Dependabot for npm and actions in `pyrlyn/cla`; Dependabot in `pyrlyn/infra` bumps the pin.

## 4. Secrets and permissions

Current state (checked 2026-10-03): `gh secret list -o pyrlyn` shows `CARGO_REGISTRY_TOKEN`,
`MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PWD`, `RELEASE_PLZ_TOKEN`. **`CLA_SIGNATURES_TOKEN` does
not exist.** There are no organization variables, so `CLA_ENABLED` is not set at org level.

| Credential | Where | Access | Used for |
| --- | --- | --- | --- |
| `github.token` | every run | job permissions below | bot comment, commit status, lock/unlock, reading the PR |
| `CLA_APP_ID`, `CLA_APP_PRIVATE_KEY` (option A) | org secrets, selected repositories | app: Organization Members read; Contents read/write on `cla-signatures` only | membership, signatures |
| `CLA_SIGNATURES_TOKEN` (option C, or old Lite) | org secret, selected repositories | fine-grained PAT: Contents read/write on `cla-signatures`; + Organization Members read for option C | signatures (+ membership) |
| `CLA_ENABLED` | org or repository variable | — | on/off switch |

Job permissions in the new reusable workflow and callers:

| Permission | Lite today | `pyrlyn/cla` | Why |
| --- | --- | --- | --- |
| `contents` | read | read | read the PR through the API |
| `pull-requests` | write | write | sticky comment, lock/unlock |
| `statuses` | write | write | commit status `pyrlyn/cla` |
| `actions` | write | **none** | no re-runs any more |

On the Free plan organization secrets reach public repositories only; all target repositories are
public.

## 5. Migration

### 5.1 Current state

- `pyrlyn/infra` `.github/workflows/cla.yml` wraps Lite `v2.6.1` (`ca4a40a`). It was added in #21
  and turned off unless `CLA_ENABLED == 'true'` by **#27** (merged). Documentation:
  `docs/cla.md`; text: `CLA.md`, `CLA.ru.md`.
- Draft callers, open, not merged: cox#120, rtok#636, ketch#228, runa#38, crates-packages#14
  (all "ci: require the pyrlyn contributor license agreement").
- Draft infra PRs: #23 (revert of #21) and #20 (licensing, CLA and Empryo plans).
- These PRs are only listed here; this plan does not change them.
- `protect-main` rulesets exist per repository (Free plan: no organization rulesets). `cox`
  requires `pipeline / gate` and other CI checks, no CLA check.
- `pyrlyn/cla-signatures`: private, empty.

### 5.2 Checklist: build the action

- [ ] Scaffold repository (`action.yml` node24, TypeScript, vitest, bundler, CI, Dependabot).
- [ ] `people.ts` with pagination, opener, `Co-authored-by`, unknown emails.
- [ ] `signing.ts` strict phrase matching, ported tests for quotes and extra text.
- [ ] `store.ts` new schema, create when missing, retry on 409, never rewrite old entries.
- [ ] `membership.ts` with app token / PAT / public fallback, clear message on 403.
- [ ] `report.ts` sticky comment, commit status texts from 2.5, step summary.
- [ ] `lock.ts` merged only, unlock on reopen.
- [ ] Integration tests: outsider unsigned, signs, recheck, two signers race, member, bot,
      impersonation, unknown email, outdated version, missing token, empty signatures repository.
- [ ] `README.md` usage; `NOTICE` for ported code; release `v1.0.0`.

### 5.3 Checklist: prepare credentials (organization owner)

- [ ] First commit in `pyrlyn/cla-signatures` (README), leave `main` unprotected.
- [ ] Create the `pyrlyn-cla` GitHub App (option A): Members read, Contents read/write; install on
      `pyrlyn/cla-signatures` only.
- [ ] `gh secret set CLA_APP_ID --org pyrlyn --visibility selected --repos cox,rtok,ketch,runa,crates-packages,infra`
      and the same for `CLA_APP_PRIVATE_KEY`.
- [ ] (Option C instead) fine-grained PAT, stored as `CLA_SIGNATURES_TOKEN`, rotation reminder.

### 5.4 Checklist: switch `pyrlyn/infra`

- [ ] New PR in infra: in `cla.yml` replace the Lite step with `actions/create-github-app-token`
      + `pyrlyn/cla@<sha> # v1.0.0`; drop `actions: write`; add concurrency; keep `CLA_ENABLED`.
- [ ] Same PR: update `docs/cla.md` (tool, storage schema, check name `pyrlyn/cla`, the 404 note)
      and `CLA.md` / `CLA.ru.md` 11.1 wording.
- [ ] Decide what happens to drafts #23 and #20 (Ivan).
- [ ] Callers: the five draft PRs need their pin moved to the new infra SHA and the `actions: write`
      permission removed before they are merged (Ivan decides; this plan does not edit them).
- [ ] crates-packages: Actions are disabled there; enable them first.

### 5.5 Checklist: enable

- [ ] Pilot: `CLA_ENABLED=true` as a **repository** variable in one repository (for example
      `ketch`) after its caller is merged.
- [ ] Test from a second, non-member account through a fork: unsigned → comment + red status;
      sign → green without re-run; `recheck`; merge → locked; signature in `cla-signatures`.
- [ ] Test a Dependabot PR and a `bump.yml` / `release-plz` PR: green as bot / member.
- [ ] Then set `CLA_ENABLED=true` as an organization variable, or per repository.

### 5.6 Checklist: make it required

Only after 5.5 passed in that repository (a required check that never reports blocks every PR).

- [ ] For each repository: Settings > Rules > Rulesets > `protect-main` > Require status checks >
      add `pyrlyn/cla` (source GitHub Actions). Or with `gh`:

```sh
gh api repos/pyrlyn/<repo>/rulesets            # find the protect-main id
gh api repos/pyrlyn/<repo>/rulesets/<id> > ruleset.json
jq '(.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks)
    += [{"context":"pyrlyn/cla"}]
    | {name, target, enforcement, conditions, rules, bypass_actors}' ruleset.json \
  | gh api -X PUT repos/pyrlyn/<repo>/rulesets/<id> --input -
```

- [ ] Open a test PR and confirm the merge box lists `pyrlyn/cla` as required.

### 5.7 Rollback

1. Fast: remove `pyrlyn/cla` from the required checks of `protect-main` (unblocks PRs at once).
2. Turn off: delete `CLA_ENABLED` or set it to anything but `true`; the job is skipped.
3. Code: revert the infra PR from 5.4 (back to Lite) or pin `pyrlyn/cla` to the previous release.
   Callers pin infra by SHA, so each caller moves only when its pin changes.
4. Keep `pyrlyn/cla-signatures` untouched; signatures are legal records and are never deleted.

Order matters: always 1 before 2, otherwise PRs wait for a status that never comes.

## 6. Open questions for Ivan

1. Members auto-pass: yes for all members, or only `listepo` (legal note in 2.1)?
2. Credential: GitHub App (recommended) or PAT?
3. License of `pyrlyn/cla`: Apache-2.0?
4. Comment language: English only with RU link, or also a Ukrainian translation of the CLA?
5. What to do with infra drafts #23 and #20.
