/**
 * Pins trimWhiteSpace/splitOnWhiteSpace on exactly the characters where
 * JS's .trim()/\s+ disagree with the Unicode White_Space set: U+FEFF (JS
 * trims and splits, White_Space does NOT) and U+0085 (White_Space trims and
 * splits, JS does NOT). A regression here flips search-mode selection and
 * search-term tokenization on BOM'd or NEL-padded queries.
 */
import { describe, expect, it } from "vitest";

import { splitOnWhiteSpace, trimWhiteSpace } from "../whitespace.js";

describe("trimWhiteSpace", () => {
  it("trims the White_Space set including U+0085 and U+00A0", () => {
    expect(trimWhiteSpace("  foo  ")).toBe("foo");
    expect(trimWhiteSpace("\t\nfoo\r\n")).toBe("foo");
    expect(trimWhiteSpace("\u0085foo\u0085")).toBe("foo");
    expect(trimWhiteSpace(" foo　")).toBe("foo");
  });

  it("does NOT trim U+FEFF: the BOM is kept", () => {
    expect(trimWhiteSpace("﻿foo")).toBe("﻿foo");
    expect(trimWhiteSpace("﻿")).toBe("﻿");
  });

  it("reduces all-space input to empty", () => {
    expect(trimWhiteSpace("")).toBe("");
    expect(trimWhiteSpace(" \t\u0085  ")).toBe("");
  });
});

describe("splitOnWhiteSpace", () => {
  it("splits around runs of the White_Space set, no empty fields", () => {
    expect(splitOnWhiteSpace("foo bar")).toEqual(["foo", "bar"]);
    expect(splitOnWhiteSpace("  foo \t bar  ")).toEqual(["foo", "bar"]);
    expect(splitOnWhiteSpace("foo\u0085bar")).toEqual(["foo", "bar"]);
  });

  it("does NOT split on U+FEFF: one token", () => {
    expect(splitOnWhiteSpace("foo﻿bar")).toEqual(["foo﻿bar"]);
  });

  it("yields [] for empty and all-space input", () => {
    expect(splitOnWhiteSpace("")).toEqual([]);
    expect(splitOnWhiteSpace(" \n\u0085 ")).toEqual([]);
  });
});
