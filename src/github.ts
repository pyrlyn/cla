import * as github from "@actions/github";
import { retry } from "@octokit/plugin-retry";

export type Github = ReturnType<typeof githubClient>;

export function githubClient(token: string): ReturnType<typeof github.getOctokit> {
  // 409 on the contents API means the blob sha is stale. Retrying the same
  // request cannot succeed; store.ts re-reads and appends instead.
  // Call global fetch at request time. The Actions proxy fetch is created when
  // @actions/github loads, so a test double installed later would never see it.
  return github.getOctokit(
    token,
    {
      retry: { retries: 3, doNotRetry: [400, 401, 403, 404, 409, 410, 422, 451] },
      request: {
        fetch: (url: string, options: RequestInit) => globalThis.fetch(url, options),
      },
    },
    retry,
  );
}
