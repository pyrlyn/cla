import { errorText, httpStatus } from "./errors.js";
import type { Github } from "./github.js";

export type MemberState = "member" | "not_member" | "unverified";

/**
 * `token` uses the org members API (app token or PAT). `public` is the fallback
 * when no such token exists: a hidden member is unverified, not a confirmed non-member.
 * A 403 is the token lacking Members: read — same outcome, and not a pass.
 */
export async function checkMembership(
  octokit: Github,
  org: string,
  login: string,
  mode: "token" | "public",
): Promise<MemberState> {
  try {
    if (mode === "public") {
      await octokit.rest.orgs.checkPublicMembershipForUser({ org, username: login });
      return "member";
    }
    await octokit.rest.orgs.checkMembershipForUser({ org, username: login });
    return "member";
  } catch (error) {
    const status = httpStatus(error);
    if (status === 204) return "member";
    if (mode === "public" && status === 404) return "unverified";
    if (mode === "token" && status === 404) return "not_member";
    if (status === 403 || status === 401) return "unverified";
    throw new Error(`membership check for ${login} failed: ${errorText(error)}`);
  }
}

export function membershipCache(
  octokit: Github,
  org: string,
  mode: "token" | "public",
): (login: string) => Promise<MemberState> {
  const cache = new Map<string, MemberState>();
  let blocked = false;
  return async (login) => {
    const hit = cache.get(login);
    if (hit) return hit;
    // A 403 is about the token, not the person. Further calls fail the same way.
    if (blocked) return "unverified";
    const state = await checkMembership(octokit, org, login, mode);
    if (state === "unverified" && mode === "token") blocked = true;
    cache.set(login, state);
    return state;
  };
}
