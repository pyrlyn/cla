import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { ConfigError } from "../../src/errors.js";
import { setInputs } from "../helpers/run.js";

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    setInputs({ allowlist: "", "minimum-version": "", "cla-token": "" });
    const config = loadConfig();
    expect(config.org).toBe("pyrlyn");
    expect(config.signaturesOwner).toBe("pyrlyn");
    expect(config.signaturesRepo).toBe("cla-signatures");
    expect(config.signaturesPath).toBe("signatures/cla.json");
    expect(config.minimumVersion).toBe("1.0");
    expect(config.claToken).toBeNull();
    expect(config.allowlist).toEqual([]);
    expect(config.statusContext).toBe("pyrlyn/cla");
  });

  it("rejects a bad document hash, repository, and allowlist", () => {
    setInputs({ "document-sha256": "abc" });
    expect(() => loadConfig()).toThrow(ConfigError);
    setInputs({ "signatures-repository": "not a repo" });
    expect(() => loadConfig()).toThrow(/owner\/name/);
    setInputs({ allowlist: "*" });
    expect(() => loadConfig()).toThrow(/\[bot\]/);
  });
});
