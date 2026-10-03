import { describe, expect, it } from "vitest";

import { isAllowlisted, parseAllowlist } from "../../src/allowlist.js";
import { ConfigError } from "../../src/errors.js";

describe("parseAllowlist", () => {
  it("rejects a wildcard that is not a bot login", () => {
    expect(() => parseAllowlist("*")).toThrow(ConfigError);
    expect(() => parseAllowlist("alice")).toThrow(ConfigError);
  });

  it("accepts an explicit bot wildcard", () => {
    const patterns = parseAllowlist("*[bot]");
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.kind).toBe("wildcard");
  });
});

describe("isAllowlisted", () => {
  it("matches a default bot only when the login and id both agree", () => {
    const patterns = parseAllowlist("dependabot[bot]");
    const ids = new Map([["dependabot[bot]", 49699333]]);
    expect(isAllowlisted("dependabot[bot]", 49699333, patterns, ids)).toBe(true);
    expect(isAllowlisted("dependabot[bot]", 1, patterns, ids)).toBe(false);
    expect(isAllowlisted("alice", 49699333, patterns, ids)).toBe(false);
  });

  it("matches an explicit bot wildcard by login", () => {
    const patterns = parseAllowlist("*[bot]");
    expect(isAllowlisted("my-app[bot]", 5, patterns, new Map())).toBe(true);
    expect(isAllowlisted("alice", 5, patterns, new Map())).toBe(false);
  });
});
