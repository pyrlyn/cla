import { describe, expect, it } from "vitest";

import { classifyPeople, impersonatedOpener } from "../../src/coverage.js";
import type { Person } from "../../src/people.js";
import type { Signature } from "../../src/store.js";

const alice: Person = { kind: "user", login: "alice", id: 10, roles: ["opener", "author"] };
const bot: Person = { kind: "user", login: "dependabot[bot]", id: 49699333, roles: ["author"] };

function signature(version: string, userId = 10): Signature {
  return {
    user: "alice",
    user_id: userId,
    cla_version: version,
    document_sha256: "ab".repeat(32),
    signed_at: "2026-10-01T00:00:00Z",
    comment_id: 1,
    comment_url: "https://github.com/pyrlyn/cox/pull/1#issuecomment-1",
    repository: "pyrlyn/cox",
    repository_id: 1,
    pull_request: 1,
  };
}

describe("classifyPeople", () => {
  it("prefers membership, then a bot, then a covering signature", () => {
    const rows = classifyPeople({
      people: [alice, bot],
      signatures: [signature("1.0"), signature("1.0", 49699333)],
      minimumVersion: "1.0",
      membersPass: true,
      membershipOf: (person) => (person.id === 10 ? "member" : "not_member"),
      allowlisted: (login) => login.endsWith("[bot]"),
    });
    expect(rows.map((row) => row.reason.kind)).toEqual(["member", "bot"]);
  });

  it("reports an older signature as outdated", () => {
    const rows = classifyPeople({
      people: [alice],
      signatures: [signature("1.0")],
      minimumVersion: "2.0",
      membersPass: false,
      membershipOf: () => undefined,
      allowlisted: () => false,
    });
    expect(rows[0]?.reason).toEqual({ kind: "outdated", signedVersion: "1.0", signedAt: "2026-10-01T00:00:00Z" });
  });
});

describe("impersonatedOpener", () => {
  it("fails an outsider opener who did not author a commit", () => {
    const opener: Person = { kind: "user", login: "mallory", id: 9, roles: ["opener"] };
    expect(
      impersonatedOpener({ require: true, people: [opener, bot], openerIsMember: false }),
    ).toBe("mallory");
  });

  it("allows a member and a co-author", () => {
    const opener: Person = { kind: "user", login: "mallory", id: 9, roles: ["opener"] };
    expect(impersonatedOpener({ require: true, people: [opener], openerIsMember: true })).toBeUndefined();
    const coauthor: Person = { kind: "user", login: "mallory", id: 9, roles: ["opener", "coauthor"] };
    expect(impersonatedOpener({ require: true, people: [coauthor], openerIsMember: false })).toBeUndefined();
  });
});
