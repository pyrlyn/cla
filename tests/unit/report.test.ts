import { describe, expect, it } from "vitest";

import type { Classified } from "../../src/coverage.js";
import { renderComment, renderStatus, type ReportModel } from "../../src/report.js";
import type { Person } from "../../src/people.js";

function user(login: string, id: number): Person {
  return { kind: "user", login, id, roles: ["author"] };
}

function row(person: Person, reason: Classified["reason"]): Classified {
  return { person, reason };
}

function model(rows: Classified[], extra: Partial<ReportModel> = {}): ReportModel {
  return {
    version: "1.0",
    phrase: "I have read the CLA Document and I hereby sign the CLA",
    documentUrl: "https://example.com/CLA.md",
    documentUrlRu: "https://example.com/CLA.ru.md",
    rows,
    membershipUnverified: false,
    ...extra,
  };
}

describe("renderStatus", () => {
  it("matches the covered, missing, unknown, and opener messages", () => {
    const covered = model([
      row(user("listepo", 1), { kind: "member" }),
      row(user("dependabot[bot]", 2), { kind: "bot" }),
      row(user("alice", 3), { kind: "signed", version: "1.0", signedAt: "2026-10-10T12:00:00Z" }),
    ]);
    expect(renderStatus(covered).description).toBe(
      "All 3 contributors covered (1 member, 1 bot, 1 signed CLA 1.0)",
    );

    const missing = model([
      row(user("alice", 3), { kind: "missing" }),
      row(user("bob", 4), { kind: "missing" }),
    ]);
    expect(renderStatus(missing)).toEqual({
      state: "failure",
      description: "CLA 1.0 signature missing: @alice, @bob. See the pull request comment.",
    });

    const unknown = model([
      row({ kind: "unknown", email: "dev@example.com", roles: ["author"] }, { kind: "unknown_email", email: "dev@example.com" }),
    ]);
    expect(renderStatus(unknown).description).toBe(
      "Unknown commit email (not linked to GitHub): 1. See the comment.",
    );

    expect(renderStatus(model([], { impersonation: "mallory" })).description).toBe(
      "PR opener @mallory is not an author of any commit.",
    );
    expect(renderStatus(model([], { error: "CLA check could not read signatures (HTTP 403). Maintainers: see the run log." })).state).toBe(
      "error",
    );
  });

  it("keeps a long missing list inside 140 characters", () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row(user(`person-${index}-with-a-long-login`, index + 1), { kind: "missing" }),
    );
    const description = renderStatus(model(rows)).description;
    expect(description.length).toBeLessThanOrEqual(140);
    expect(description.startsWith("CLA 1.0 signature missing:")).toBe(true);
  });
});

describe("renderComment", () => {
  it("is one line without mentions when everyone is covered", () => {
    const text = renderComment(model([row(user("alice", 1), { kind: "member" })]));
    expect(text).toContain("All contributors are covered");
    expect(text).not.toContain("@");
  });

  it("tells an outdated signer which version is required", () => {
    const text = renderComment(
      model([row(user("alice", 1), { kind: "outdated", signedVersion: "1.0", signedAt: "2026-01-01T00:00:00Z" })], {
        version: "2.0",
      }),
    );
    expect(text).toContain("You signed version 1.0; version 2.0 is now required");
    expect(text).toContain("@alice");
  });
});
