import { describe, expect, it } from "vitest";
import { relocatePrefix } from "../../scripts/lib/misplaced-prefix";

/**
 * Pins for the prefix guard's reversed-form detection (stigmer/stigmer#1227).
 * A class written `sm:stg:grid-cols-2` compiles to nothing, so the guard in
 * `scripts/prefix-classnames.ts` must find it and name the correct spelling,
 * reading colons inside brackets and parentheses as part of a segment.
 */

// prefix-classnames-ignore: the fixtures are the reversed and unprefixed
// spellings under test, not classes this file renders.
describe("relocatePrefix", () => {
  it.each([
    ["sm:stg:grid-cols-2", "stg:sm:grid-cols-2"],
    ["hover:stg:text-foreground", "stg:hover:text-foreground"],
    ["dark:hover:stg:bg-accent", "stg:dark:hover:bg-accent"],
    ["data-[state=open]:stg:zoom-in-95", "stg:data-[state=open]:zoom-in-95"],
    ["supports-(display:grid):stg:grid", "stg:supports-(display:grid):grid"],
    ["group-hover/row:stg:opacity-100", "stg:group-hover/row:opacity-100"],
  ])("moves the prefix in %s to the front", (token, expected) => {
    expect(relocatePrefix(token, "stg:")).toBe(expected);
  });

  it.each([
    "stg:sm:grid-cols-2",
    "stg:[mask-type:luminance]",
    "stg:bg-(--stgm-card)",
    "stg:data-[state=open]:zoom-in-95",
    "grid-cols-2",
    "hover:text-foreground",
    "[stgm:perf:keys]",
    "https://example.test/stg:x",
  ])("leaves %s alone", (token) => {
    expect(relocatePrefix(token, "stg:")).toBeUndefined();
  });

  it("reads a prefix given without its colon", () => {
    expect(relocatePrefix("sm:stg:flex", "stg")).toBe("stg:sm:flex");
  });
});
