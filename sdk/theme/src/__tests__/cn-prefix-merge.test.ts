import { describe, expect, it } from "vitest";
import { cn } from "../utils";

/**
 * Pins the #454 override contract: the `stg:` utility prefix must be
 * TRANSPARENT for tailwind-merge conflict grouping, so a host's unprefixed
 * `className` utilities still displace the SDK's prefixed defaults. If these
 * pins fail, `cn("stg:p-2", hostClassName)` keeps both classes and the SDK's
 * higher cascade layer silently wins — the documented override channel
 * (DD-019) breaks without any visible error.
 */
describe("cn: stg: prefix is transparent for conflict grouping", () => {
  it("host unprefixed utility displaces the SDK's prefixed default", () => {
    expect(cn("stg:p-2", "p-4")).toBe("p-4");
  });

  it("SDK-internal merges keep the prefixed spelling", () => {
    expect(cn("stg:p-2", "stg:p-4")).toBe("stg:p-4");
  });

  it("non-conflicting utilities from both spellings all survive", () => {
    expect(cn("stg:flex stg:gap-2", "p-4")).toBe("stg:flex stg:gap-2 p-4");
  });

  it("variant conflicts resolve across spellings", () => {
    expect(cn("stg:hover:bg-red-500", "hover:bg-blue-500")).toBe(
      "hover:bg-blue-500",
    );
  });

  it("SDK prefixed utility displaces an earlier host utility", () => {
    // SDK call sites put the host className LAST (cn(base, className)), but
    // the grouping must be symmetric.
    expect(cn("p-4", "stg:p-2")).toBe("stg:p-2");
  });

  it("non-Tailwind classes pass through untouched", () => {
    expect(cn("stg:p-2", "custom-class")).toBe("stg:p-2 custom-class");
    expect(cn("stgm-thread-item-enter", "stg:opacity-50")).toBe(
      "stgm-thread-item-enter stg:opacity-50",
    );
  });

  it("conditional falsy inputs are dropped (clsx semantics)", () => {
    expect(cn("stg:flex", false, undefined, null, "stg:gap-2")).toBe(
      "stg:flex stg:gap-2",
    );
  });
});
