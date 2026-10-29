/**
 * Pins the query escaping on the exact characters where URLSearchParams
 * would diverge, the reason these helpers exist. The artifact storage's
 * signed-URL tests exercise queryEscape end-to-end; this file pins the
 * primitive and the sorted-values composition directly.
 */
import { describe, expect, it } from "vitest";

import { encodeQueryValues, queryEscape } from "../query-escape.js";

describe("queryEscape", () => {
  it("escapes the characters where URLSearchParams diverges", () => {
    expect(queryEscape("a b")).toBe("a+b"); // space → '+'
    expect(queryEscape("~tilde")).toBe("~tilde"); // '~' unescaped (URLSearchParams escapes it)
    expect(queryEscape("star*")).toBe("star%2A"); // '*' escaped (URLSearchParams leaves it bare)
    expect(queryEscape("repo,read:user")).toBe("repo%2Cread%3Auser");
    expect(queryEscape("https://x.example/cb")).toBe("https%3A%2F%2Fx.example%2Fcb");
  });

  it("percent-encodes multi-byte UTF-8 per byte, uppercase hex", () => {
    expect(queryEscape("é")).toBe("%C3%A9");
  });
});

describe("encodeQueryValues", () => {
  it("sorts keys and escapes keys and values", () => {
    expect(
      encodeQueryValues({ b: "2 2", a: "1", "c:key": "v" }),
    ).toBe("a=1&b=2+2&c%3Akey=v");
  });

  it("keeps empty values as key=", () => {
    expect(encodeQueryValues({ a: "" })).toBe("a=");
  });
});
