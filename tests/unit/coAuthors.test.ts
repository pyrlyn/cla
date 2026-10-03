import { describe, expect, it } from "vitest";

import { parseCoAuthors } from "../../src/coAuthors.js";

describe("parseCoAuthors", () => {
  it("extracts a single trailer from a conventional footer block", () => {
    const message = [
      "Refactor signatures handling",
      "",
      "Details about the change.",
      "",
      "Co-authored-by: Alice Example <alice@example.com>",
    ].join("\n");
    expect(parseCoAuthors(message)).toEqual([{ name: "Alice Example", email: "alice@example.com" }]);
  });

  it("extracts multiple trailers and deduplicates by name and email", () => {
    const message = [
      "Fix bug",
      "",
      "Co-authored-by: Alice <alice@example.com>",
      "Co-authored-by: Bob <bob@example.com>",
      "Co-authored-by: alice <alice@example.com>",
    ].join("\n");
    expect(parseCoAuthors(message).map((co) => co.email)).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("is case-insensitive on the Co-authored-by key", () => {
    expect(parseCoAuthors("Title\n\nCO-AUTHORED-BY: Alice <a@example.com>")).toHaveLength(1);
  });

  it("extracts login and numeric id from the modern noreply form", () => {
    expect(parseCoAuthors("Title\n\nCo-authored-by: Alice <12345+alice@users.noreply.github.com>")).toEqual([
      {
        name: "Alice",
        email: "12345+alice@users.noreply.github.com",
        noreplyLogin: "alice",
        noreplyId: 12345,
      },
    ]);
  });

  it("extracts login from the legacy noreply form", () => {
    expect(parseCoAuthors("Title\n\nCo-authored-by: Alice <alice@users.noreply.github.com>")).toEqual([
      { name: "Alice", email: "alice@users.noreply.github.com", noreplyLogin: "alice" },
    ]);
  });

  it("returns an empty list when the message contains no trailers", () => {
    expect(parseCoAuthors("fix: one-liner commit")).toEqual([]);
    expect(parseCoAuthors("")).toEqual([]);
  });

  it("ignores malformed trailer-like lines", () => {
    const message = [
      "Title",
      "",
      "Co-authored-by Alice <alice@example.com>",
      "Co-authored-by: Alice <not-an-email>",
      "Co-authored-by: <alice@example.com>",
    ].join("\n");
    expect(parseCoAuthors(message)).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCoAuthors("Title\r\n\r\nCo-authored-by: Alice <a@example.com>\r\n")).toHaveLength(1);
  });
});
