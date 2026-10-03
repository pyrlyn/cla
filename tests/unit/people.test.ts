import { describe, expect, it } from "vitest";

import { WEB_FLOW_ID, collectPeople } from "../../src/people.js";

describe("collectPeople", () => {
  const opener = { login: "alice", id: 10 };

  it("merges the opener with the author and drops web-flow", () => {
    const people = collectPeople(opener, [
      {
        author: { login: "alice", id: 10 },
        committer: { login: "web-flow", id: WEB_FLOW_ID },
      },
    ]);
    expect(people).toEqual([{ kind: "user", login: "alice", id: 10, roles: ["opener", "author"] }]);
  });

  it("keeps an author email that GitHub could not link", () => {
    const people = collectPeople(opener, [
      { author: { email: "Dev@example.com", name: "Dev" }, committer: null },
    ]);
    expect(people.map((person) => person.kind)).toEqual(["user", "unknown"]);
    expect(people[1]).toMatchObject({ email: "Dev@example.com", roles: ["author"] });
  });

  it("counts a Co-authored-by noreply identity", () => {
    const people = collectPeople(opener, [
      {
        message: "feat: pair\n\nCo-authored-by: Bob <20+bob@users.noreply.github.com>",
        author: { login: "alice", id: 10 },
        committer: { login: "alice", id: 10 },
      },
    ]);
    expect(people).toEqual([
      { kind: "user", login: "alice", id: 10, roles: ["opener", "author", "committer"] },
      { kind: "user", login: "bob", id: 20, roles: ["coauthor"] },
    ]);
  });

  it("counts a committer who is a different GitHub user", () => {
    const people = collectPeople(opener, [
      {
        author: { login: "alice", id: 10 },
        committer: { login: "bob", id: 20 },
      },
    ]);
    expect(people.map((person) => (person.kind === "user" ? person.login : person.email))).toEqual(["alice", "bob"]);
  });
});
