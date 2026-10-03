import { ConfigError, errorText, httpStatus } from "./errors.js";
import type { Github } from "./github.js";

/**
 * Known bot ids. Login is checked together with the id because a login can be
 * renamed and an email can be pointed at someone else's account.
 */
export const DEFAULT_BOT_IDS: Readonly<Record<string, number>> = {
  "dependabot[bot]": 49699333,
  "github-actions[bot]": 41898282,
  "renovate[bot]": 29139614,
};

export type AllowPattern =
  | { kind: "exact"; login: string }
  | { kind: "wildcard"; login: string; regex: RegExp };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wildcards exist only for bot logins, and only when a caller writes one. */
export function parseAllowlist(raw: string): AllowPattern[] {
  if (raw.trim() === "") return [];
  return raw.split(",").map((part) => {
    const login = part.trim();
    if (login === "") throw new ConfigError("allowlist has an empty entry");
    if (!login.toLowerCase().endsWith("[bot]")) {
      throw new ConfigError(`allowlist entry ${login} must be a bot login ending in [bot]`);
    }
    if (login.includes("*")) {
      const regex = new RegExp(`^${escapeRegExp(login).replace(/\\\*/g, ".*")}$`, "i");
      return { kind: "wildcard", login, regex };
    }
    return { kind: "exact", login };
  });
}

export async function resolveAllowlistIds(
  octokit: Github,
  patterns: readonly AllowPattern[],
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const pattern of patterns) {
    if (pattern.kind !== "exact") continue;
    const key = pattern.login.toLowerCase();
    const known = DEFAULT_BOT_IDS[pattern.login] ?? DEFAULT_BOT_IDS[key];
    if (known) {
      ids.set(key, known);
      continue;
    }
    try {
      const { data } = await octokit.rest.users.getByUsername({ username: pattern.login });
      ids.set(key, data.id);
    } catch (error) {
      if (httpStatus(error) === 404) continue;
      throw new Error(`could not resolve allowlist bot ${pattern.login}: ${errorText(error)}`);
    }
  }
  return ids;
}

export function isAllowlisted(
  login: string,
  id: number,
  patterns: readonly AllowPattern[],
  ids: ReadonlyMap<string, number>,
): boolean {
  if (id <= 0) return false;
  for (const pattern of patterns) {
    if (pattern.kind === "exact") {
      const expected = ids.get(pattern.login.toLowerCase());
      if (expected === undefined) continue;
      if (login.toLowerCase() === pattern.login.toLowerCase() && id === expected) return true;
      continue;
    }
    if (pattern.regex.test(login) && login.toLowerCase().endsWith("[bot]")) return true;
  }
  return false;
}
