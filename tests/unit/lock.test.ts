import { describe, expect, it } from "vitest";

import type { Github } from "../../src/github.js";
import { lockConversation, unlockConversation } from "../../src/lock.js";

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function client(
  lock: (args: unknown) => Promise<void>,
  unlock: (args: unknown) => Promise<void> = async () => {},
): Github {
  return { rest: { issues: { lock, unlock } } } as unknown as Github;
}

describe("lockConversation", () => {
  it("locks with the resolved reason", async () => {
    const calls: unknown[] = [];
    await lockConversation(
      client(async (args) => {
        calls.push(args);
      }),
      "pyrlyn",
      "cox",
      12,
    );
    expect(calls).toEqual([{ owner: "pyrlyn", repo: "cox", issue_number: 12, lock_reason: "resolved" }]);
  });

  it("ignores a 403 that says the conversation is already locked", async () => {
    await expect(
      lockConversation(client(async () => {
        throw httpError(403, "Issue is already LOCKED");
      }), "pyrlyn", "cox", 12),
    ).resolves.toBeUndefined();
  });

  it("rethrows a 403 that is not about the lock, and any other status", async () => {
    const forbidden = httpError(403, "Resource not accessible by integration");
    await expect(lockConversation(client(async () => {
      throw forbidden;
    }), "pyrlyn", "cox", 12)).rejects.toBe(forbidden);
    const unavailable = httpError(500, "locked");
    await expect(lockConversation(client(async () => {
      throw unavailable;
    }), "pyrlyn", "cox", 12)).rejects.toBe(unavailable);
  });
});

describe("unlockConversation", () => {
  it("ignores a 403 that says the conversation is not locked", async () => {
    await expect(
      unlockConversation(client(async () => {}, async () => {
        throw httpError(403, "Issue is not locked");
      }), "pyrlyn", "cox", 12),
    ).resolves.toBeUndefined();
  });

  it("rethrows when the 403 is a different failure", async () => {
    const forbidden = httpError(403, "Issue is locked");
    await expect(unlockConversation(client(async () => {}, async () => {
      throw forbidden;
    }), "pyrlyn", "cox", 12)).rejects.toBe(forbidden);
  });
});
