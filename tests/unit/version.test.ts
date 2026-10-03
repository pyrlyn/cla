import { describe, expect, it } from "vitest";

import { compareVersions, versionSatisfies } from "../../src/version.js";

describe("compareVersions", () => {
  it("orders dotted numbers and treats a missing part as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2", "1.10")).toBe(-1);
    expect(compareVersions("2.0", "1.9")).toBe(1);
  });

  it("accepts a signature at or above the minimum", () => {
    expect(versionSatisfies("1.0", "1.0")).toBe(true);
    expect(versionSatisfies("1.0", "2.0")).toBe(false);
    expect(versionSatisfies("nope", "1.0")).toBe(false);
  });
});
