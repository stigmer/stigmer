/**
 * Pins the Go net/url encoding ports on the exact characters where
 * URLSearchParams would diverge — the reason these helpers exist. The
 * artifact storage's signed-URL tests exercise goQueryEscape end-to-end;
 * this file pins the primitive and the Values.Encode composition directly.
 */
import { describe, expect, it } from "vitest";

import { goQueryEscape, goUrlValuesEncode } from "../query-escape.js";

describe("goQueryEscape", () => {
  it("matches Go url.QueryEscape on the divergent characters", () => {
    expect(goQueryEscape("a b")).toBe("a+b"); // space → '+'
    expect(goQueryEscape("~tilde")).toBe("~tilde"); // '~' unescaped (URLSearchParams escapes it)
    expect(goQueryEscape("star*")).toBe("star%2A"); // '*' escaped (URLSearchParams leaves it bare)
    expect(goQueryEscape("repo,read:user")).toBe("repo%2Cread%3Auser");
    expect(goQueryEscape("https://x.example/cb")).toBe("https%3A%2F%2Fx.example%2Fcb");
  });

  it("percent-encodes multi-byte UTF-8 per byte, uppercase hex", () => {
    expect(goQueryEscape("é")).toBe("%C3%A9");
  });
});

describe("goUrlValuesEncode", () => {
  it("sorts keys and escapes keys and values (Go url.Values.Encode)", () => {
    expect(
      goUrlValuesEncode({ b: "2 2", a: "1", "c:key": "v" }),
    ).toBe("a=1&b=2+2&c%3Akey=v");
  });

  it("keeps empty values as key=", () => {
    expect(goUrlValuesEncode({ a: "" })).toBe("a=");
  });
});
