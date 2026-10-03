import { readFileSync } from "node:fs";

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FakeGithub } from "../helpers/fakeGithub.js";
import { PHRASE, SHA256, aliceCommit, opened, outputs, runEvent, setInputs } from "../helpers/run.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  process.exitCode = undefined;
});
afterAll(() => server.close());

function use(fake: FakeGithub): void {
  server.use(...fake.handlers());
}

function summary(): string {
  return readFileSync(process.env.GITHUB_STEP_SUMMARY ?? "", "utf8");
}

function saved(fake: FakeGithub): { schema: number; signatures: Array<Record<string, unknown>> } {
  const text = fake.puts.at(-1);
  if (!text) throw new Error("nothing was written");
  return JSON.parse(text) as { schema: number; signatures: Array<Record<string, unknown>> };
}

describe("pull request check", () => {
  it("fails an unsigned outsider and posts the phrase", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    use(fake);
    setInputs();
    const output = await runEvent("pull_request_target", opened());
    expect(process.exitCode).toBeUndefined();
    expect(fake.statuses).toEqual([
      expect.objectContaining({
        state: "failure",
        context: "pyrlyn/cla",
        description: "CLA 1.0 signature missing: @alice. See the pull request comment.",
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ]);
    expect(fake.statuses[0]?.target_url).toContain("#issuecomment-");
    expect(fake.created[0]).toContain(PHRASE);
    expect(fake.created[0]).toContain("@alice");
    expect(fake.created[0]).toContain("<!-- pyrlyn-cla -->");
    expect(fake.puts).toEqual([]);
    expect(outputs(output)).toContain("false");
    expect(outputs(output)).toContain('["alice"]');
    expect(summary()).toContain("Missing signature");
  });

  it("records a signature and turns the status green", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.comments = [
      {
        id: 9,
        body: PHRASE,
        created_at: "2026-10-02T08:00:00Z",
        html_url: "https://github.com/pyrlyn/cox/pull/12#issuecomment-9",
        user: { login: "alice", id: 10 },
      },
    ];
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.statuses[0]).toEqual(
      expect.objectContaining({
        state: "success",
        description: "All 1 contributor covered (1 signed CLA 1.0)",
      }),
    );
    const file = saved(fake);
    expect(file.schema).toBe(1);
    expect(file.signatures).toEqual([
      expect.objectContaining({
        user: "alice",
        user_id: 10,
        cla_version: "1.0",
        document_sha256: SHA256,
        comment_id: 9,
        repository: "pyrlyn/cox",
        repository_id: 4242,
        pull_request: 12,
      }),
    ]);
    expect(fake.created[0]).not.toContain("@");
  });

  it("does not treat a quoted phrase as a signature", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.comments = [
      {
        id: 9,
        body: `> ${PHRASE}`,
        created_at: "2026-10-02T08:00:00Z",
        html_url: "https://github.com/pyrlyn/cox/pull/12#issuecomment-9",
        user: { login: "alice", id: 10 },
      },
    ];
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.puts).toEqual([]);
    expect(fake.statuses[0]?.state).toBe("failure");
  });

  it("rechecks an existing signature onto the pull request head", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.file = {
      sha: "s1",
      text: JSON.stringify({
        schema: 1,
        signatures: [
          {
            user: "old-login",
            user_id: 10,
            cla_version: "1.0",
            document_sha256: SHA256,
            signed_at: "2026-10-01T00:00:00Z",
            comment_id: 3,
            comment_url: "https://github.com/pyrlyn/cox/pull/1#issuecomment-3",
            repository: "pyrlyn/ketch",
            repository_id: 1,
            pull_request: 1,
          },
        ],
      }),
    };
    use(fake);
    setInputs();
    await runEvent("issue_comment", {
      action: "created",
      issue: { number: 12, pull_request: { url: "https://api.github.com/repos/pyrlyn/cox/pulls/12" } },
      comment: {
        id: 4,
        body: "recheck",
        user: { login: "alice", id: 10 },
        created_at: "2026-10-03T00:00:00Z",
      },
      repository: { id: 4242 },
    });
    expect(fake.puts).toEqual([]);
    expect(fake.statuses[0]).toEqual(
      expect.objectContaining({ state: "success", sha: fake.headSha, context: "pyrlyn/cla" }),
    );
  });

  it("keeps both signatures when two writes race", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.comments = [
      {
        id: 9,
        body: `\n  ${PHRASE}  \n`,
        created_at: "2026-10-02T08:00:00Z",
        html_url: "https://github.com/pyrlyn/cox/pull/12#issuecomment-9",
        user: { login: "alice", id: 10 },
      },
    ];
    const bob = {
      user: "bob",
      user_id: 2,
      cla_version: "1.0",
      document_sha256: SHA256,
      signed_at: "2026-10-02T07:00:00Z",
      comment_id: 8,
      comment_url: "https://github.com/pyrlyn/ketch/pull/4#issuecomment-8",
      repository: "pyrlyn/ketch",
      repository_id: 8,
      pull_request: 4,
      note: "keep",
    };
    fake.raceFile = JSON.stringify({ schema: 1, signatures: [bob] });
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    const file = saved(fake);
    expect(file.signatures.map((entry) => entry.user)).toEqual(["bob", "alice"]);
    expect(file.signatures[0]).toEqual(bob);
    expect(process.exitCode).toBeUndefined();
  });

  it("passes an organization member without a signature", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.members.add("alice");
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.puts).toEqual([]);
    expect(fake.statuses[0]?.description).toBe("All 1 contributor covered (1 member)");
    expect(fake.created[0]).not.toContain("@");
  });

  it("passes an allowlisted bot by id and login", async () => {
    const fake = new FakeGithub();
    fake.opener = { login: "dependabot[bot]", id: 49699333 };
    fake.commits = [
      {
        message: "chore: bump",
        author: { login: "dependabot[bot]", id: 49699333 },
        committer: { login: "dependabot[bot]", id: 49699333 },
      },
    ];
    use(fake);
    setInputs();
    await runEvent(
      "pull_request_target",
      opened({ user: { login: "dependabot[bot]", id: 49699333 } }),
    );
    expect(fake.statuses[0]?.description).toBe("All 1 contributor covered (1 bot)");
  });

  it("fails when the opener is not an author", async () => {
    const fake = new FakeGithub();
    fake.commits = [
      {
        message: "chore: bump",
        author: { login: "dependabot[bot]", id: 49699333 },
        committer: { login: "web-flow", id: 19864447 },
      },
    ];
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened({ user: { login: "mallory", id: 9 } }));
    expect(fake.statuses[0]?.description).toBe("PR opener @mallory is not an author of any commit.");
    expect(fake.created[0]).toContain("does not cover the opener");
  });

  it("fails on an email that is not linked to GitHub", async () => {
    const fake = new FakeGithub();
    fake.commits = [
      aliceCommit(),
      {
        message: "fix: unsigned machine",
        author: { email: "dev@example.com", name: "Dev" },
        committer: { login: "alice", id: 10 },
      },
    ];
    fake.pageSize = 1;
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.graphqlCalls).toBe(2);
    expect(fake.statuses[0]?.description).toBe(
      "Unknown commit email (not linked to GitHub): 1. See the comment.",
    );
    expect(fake.created[0]).toContain("`dev@example.com`");
    expect(fake.created[0]).toContain("https://github.com/settings/emails");
  });

  it("rejects a signature of an older version", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.file = {
      sha: "s1",
      text: JSON.stringify({
        schema: 1,
        signatures: [
          {
            user: "alice",
            user_id: 10,
            cla_version: "1.0",
            document_sha256: "cd".repeat(32),
            signed_at: "2026-01-01T00:00:00Z",
            comment_id: 3,
            comment_url: "https://github.com/pyrlyn/cox/pull/1#issuecomment-3",
            repository: "pyrlyn/cox",
            repository_id: 4242,
            pull_request: 1,
          },
        ],
      }),
    };
    use(fake);
    setInputs({ "cla-version": "2.0", "minimum-version": "2.0" });
    await runEvent("pull_request_target", opened());
    expect(fake.statuses[0]?.state).toBe("failure");
    expect(fake.created[0]).toContain("You signed version 1.0; version 2.0 is now required");
    expect(fake.puts).toEqual([]);
  });

  it("sets an error status when the signatures token is missing", async () => {
    const fake = new FakeGithub();
    use(fake);
    setInputs({ "cla-token": "" });
    const output = await runEvent("pull_request_target", opened());
    expect(process.exitCode).toBeUndefined();
    expect(fake.graphqlCalls).toBe(0);
    expect(fake.statuses[0]?.state).toBe("error");
    expect(fake.statuses[0]?.description).toBe(
      "CLA check could not read signatures (missing cla-token). Maintainers: see the run log.",
    );
    expect(outputs(output)).toContain("false");
  });

  it("sets an error status when signature storage answers 403", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.contentsStatus = 403;
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.statuses[0]?.description).toBe(
      "CLA check could not read signatures (HTTP 403). Maintainers: see the run log.",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("sets an error status when the signatures repository is empty", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.emptyRepo = true;
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.statuses[0]?.description).toBe(
      "CLA check could not read signatures (empty repository). Maintainers: see the run log.",
    );
    expect(fake.puts).toEqual([]);
  });

  it("says membership could not be verified on 403 and still requires a signature", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.memberHttp = 403;
    use(fake);
    setInputs();
    await runEvent("pull_request_target", opened());
    expect(fake.statuses[0]?.state).toBe("failure");
    expect(fake.created[0]).toContain("Organization membership could not be verified");
  });

  it("locks only a merged pull request", async () => {
    const merged = new FakeGithub();
    use(merged);
    setInputs();
    await runEvent("pull_request_target", { action: "closed", pull_request: { number: 12, merged: true }, repository: { id: 4242 } });
    expect(merged.locks).toBe(1);
    expect(merged.statuses).toEqual([]);

    const closed = new FakeGithub();
    server.resetHandlers();
    use(closed);
    await runEvent("pull_request_target", { action: "closed", pull_request: { number: 12, merged: false }, repository: { id: 4242 } });
    expect(closed.locks).toBe(0);
  });

  it("unlocks a reopened pull request and checks again", async () => {
    const fake = new FakeGithub();
    fake.commits = [aliceCommit()];
    fake.members.add("alice");
    use(fake);
    setInputs();
    await runEvent("pull_request_target", { ...opened(), action: "reopened" });
    expect(fake.unlocks).toBe(1);
    expect(fake.statuses[0]?.state).toBe("success");
  });

  it("fails the job on bad configuration and sets no status", async () => {
    const fake = new FakeGithub();
    use(fake);
    setInputs({ "document-sha256": "nope" });
    await runEvent("pull_request_target", opened());
    expect(process.exitCode).toBe(1);
    expect(fake.statuses).toEqual([]);
  });
});
