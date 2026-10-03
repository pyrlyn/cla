import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { SIGN_PHRASE } from "../../src/signing.js";
import { FakeGithub } from "./fakeGithub.js";

export const SHA256 = "ab".repeat(32);
export const PHRASE = SIGN_PHRASE;

export function setInputs(overrides: Record<string, string> = {}): void {
  const values: Record<string, string> = {
    "github-token": "ghs_test",
    "cla-token": "ghs_cla",
    org: "pyrlyn",
    "members-pass": "true",
    allowlist: "dependabot[bot],github-actions[bot],renovate[bot]",
    "signatures-repository": "pyrlyn/cla-signatures",
    "signatures-branch": "main",
    "signatures-path": "signatures/cla.json",
    "document-url": "https://github.com/pyrlyn/infra/blob/abc/CLA.md",
    "document-url-ru": "https://github.com/pyrlyn/infra/blob/abc/CLA.ru.md",
    "cla-version": "1.0",
    "document-sha256": SHA256,
    "minimum-version": "1.0",
    "sign-phrase": PHRASE,
    "status-context": "pyrlyn/cla",
    "lock-after-merge": "true",
    "require-opener-as-author": "true",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    process.env[`INPUT_${key.replace(/ /g, "_").toUpperCase()}`] = value;
  }
}

export async function runEvent(eventName: string, payload: unknown): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "cla-"));
  const eventPath = join(dir, "event.json");
  const summary = join(dir, "summary.md");
  const output = join(dir, "output.txt");
  writeFileSync(eventPath, JSON.stringify(payload));
  writeFileSync(summary, "");
  writeFileSync(output, "");
  process.env.GITHUB_EVENT_PATH = eventPath;
  process.env.GITHUB_EVENT_NAME = eventName;
  process.env.GITHUB_REPOSITORY = "pyrlyn/cox";
  process.env.GITHUB_API_URL = "https://api.github.com";
  process.env.GITHUB_SERVER_URL = "https://github.com";
  process.env.GITHUB_STEP_SUMMARY = summary;
  process.env.GITHUB_OUTPUT = output;
  vi.resetModules();
  const { run } = await import("../../src/main.js");
  await run();
  return output;
}

export function opened(pull: Record<string, unknown> = {}): {
  action: string;
  pull_request: Record<string, unknown>;
  repository: { id: number };
} {
  return {
    action: "opened",
    pull_request: {
      number: 12,
      merged: false,
      head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      user: { login: "alice", id: 10 },
      ...pull,
    },
    repository: { id: 4242 },
  };
}

export function aliceCommit(): FakeGithub["commits"][number] {
  return {
    message: "feat: add a thing",
    author: { login: "alice", id: 10, email: "alice@example.com", name: "Alice" },
    committer: { login: "alice", id: 10, email: "alice@example.com", name: "Alice" },
  };
}

export function outputs(file: string): string {
  return readFileSync(file, "utf8");
}
