import { describe, expect, it } from "vitest";

import { ClaCheckError, ConfigError, errorText, httpStatus } from "../../src/errors.js";

describe("ClaCheckError", () => {
  it("keeps a short status description and the full message", () => {
    const error = new ClaCheckError("signature missing", "alice has not signed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ClaCheckError");
    expect(error.description).toBe("signature missing");
    expect(error.message).toBe("alice has not signed");
  });

  it("cuts a status description at the GitHub limit", () => {
    const full = "x".repeat(141);
    const error = new ClaCheckError(full);
    expect(error.message).toBe(full);
    expect(error.description).toHaveLength(140);
    expect(error.description).toBe(`${"x".repeat(139)}…`);
    expect(new ClaCheckError("y".repeat(140)).description).toBe("y".repeat(140));
  });
});

describe("ConfigError", () => {
  it("names itself so callers can tell it from a check failure", () => {
    const error = new ConfigError("bad hash");
    expect(error.name).toBe("ConfigError");
    expect(error.message).toBe("bad hash");
  });
});

describe("httpStatus", () => {
  it("reads a numeric status and ignores anything else", () => {
    expect(httpStatus({ status: 404 })).toBe(404);
    expect(httpStatus({ status: 0 })).toBe(0);
    expect(httpStatus({ status: "404" })).toBeUndefined();
    expect(httpStatus(null)).toBeUndefined();
    expect(httpStatus("404")).toBeUndefined();
  });
});

describe("errorText", () => {
  it("uses the message of an Error and stringifies the rest", () => {
    expect(errorText(new Error("gone"))).toBe("gone");
    expect(errorText("plain")).toBe("plain");
    expect(errorText(3)).toBe("3");
  });
});
