# Done

The action already checks a pull request, stores signatures, posts one comment, and sets the `pyrlyn/cla` commit status. `npm test` runs the vitest unit and integration suites. `npm run build` writes `dist/index.js`, which is the file GitHub runs.

### T9. Test check errors and lock idempotency

`ClaCheckError` truncation, `httpStatus`, and `errorText` had no direct tests. `lock.ts` treats a 403 as success only when the message says the conversation is already locked or not locked, and that branch was untested. An `issue_comment` whose body is the sign phrase (not `recheck`) was also untested. Done means: unit tests for those branches, plus scenarios for the phrase and for a comment that must not run the check.

`npx vitest run` passed 88 tests in 12 files, including `tests/unit/errors.test.ts`, `tests/unit/lock.test.ts`, and the sign-phrase cases in `tests/integration/scenarios.test.ts`. `github.ts` stays untested on its own: the client factory is already used by the membership tests.

### T4. Markdown injection into the report via commit author email

Execution plan: add adversarial report tests for Markdown table separators, backticks, HTML and line breaks; encode unknown email text inside a code element in src/report.ts; run all tests, typecheck, lint and regenerate the action bundle. No existing shared escaping helper was found; use built-in string replacement without a new dependency.

`src/report.ts:116-119` renders `row.person.email` — attacker-controlled fork-PR commit data — inside a single-backtick span; a `|` or a backtick breaks out and injects arbitrary Markdown lines into the bot comment (no XSS — GitHub sanitizes — but the report can be forged). Done means: `|` and backticks are escaped when rendering unknown emails.

Validation: the adversarial email test failed before the fix; all 89 tests, typecheck, lint and bundle build pass after it. Unknown email text is encoded inside a code element, preserving a single table cell without allowing Markdown or HTML injection. Regenerated dist/index.js. No new dependency.

### T9. Restore workflow lint compliance

Execution plan: reproduce jactionlint failures, add per-ref concurrency and bounded jobs, disable checkout credential persistence, and configure Dependabot cooldowns. Re-run the exact shared CI lint command and application tests. Reuse existing workflow patterns and tools; no dependency versions change.

Validation: the shared pipeline jactionlint command failed before the fixes and passes afterwards. All 89 application tests pass. Per-tag release concurrency does not cancel separate releases. The shared pyrlyn/ci references remain floating as required by its no-pinned-ci policy.
