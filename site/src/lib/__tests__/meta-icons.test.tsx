import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { resolveMetaIcon } from "../meta-icons";

describe("resolveMetaIcon", () => {
  it("returns undefined when meta.json declares no icon", () => {
    expect(resolveMetaIcon(undefined)).toBeUndefined();
  });

  it("resolves a registered icon name to a React element", () => {
    expect(isValidElement(resolveMetaIcon("SquareTerminal"))).toBe(true);
  });

  it("fails loudly on unregistered names so meta.json typos break the build", () => {
    expect(() => resolveMetaIcon("NotARealIcon")).toThrowError(
      /Unknown icon "NotARealIcon".*meta-icons/,
    );
  });
});
