import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { githubClient } from "../../src/github.js";
import { checkMembership, membershipCache } from "../../src/membership.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function member(status: number): void {
  server.use(
    http.get("https://api.github.com/orgs/pyrlyn/members/alice", () =>
      status === 204 ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({ message: "no" }, { status }),
    ),
    http.get("https://api.github.com/orgs/pyrlyn/public_members/alice", () =>
      status === 204 ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({ message: "no" }, { status }),
    ),
  );
}

describe("checkMembership", () => {
  const octokit = githubClient("ghs_test");

  it("reads private membership with a token", async () => {
    member(204);
    expect(await checkMembership(octokit, "pyrlyn", "alice", "token")).toBe("member");
    member(404);
    expect(await checkMembership(octokit, "pyrlyn", "alice", "token")).toBe("not_member");
    member(403);
    expect(await checkMembership(octokit, "pyrlyn", "alice", "token")).toBe("unverified");
  });

  it("treats a hidden public membership as unverified", async () => {
    member(404);
    expect(await checkMembership(octokit, "pyrlyn", "alice", "public")).toBe("unverified");
    member(204);
    expect(await checkMembership(octokit, "pyrlyn", "alice", "public")).toBe("member");
  });

  it("does not call the API again after a token 403", async () => {
    let calls = 0;
    server.use(
      http.get(/\/orgs\/pyrlyn\/members\//, () => {
        calls += 1;
        return HttpResponse.json({ message: "forbidden" }, { status: 403 });
      }),
    );
    const cached = membershipCache(octokit, "pyrlyn", "token");
    expect(await cached("alice")).toBe("unverified");
    expect(await cached("bob")).toBe("unverified");
    expect(calls).toBe(1);
  });
});
