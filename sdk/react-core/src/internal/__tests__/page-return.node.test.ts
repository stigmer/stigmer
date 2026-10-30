// @vitest-environment node
/**
 * Proves onPageReturn (../page-return.ts) outside a browser, as the Ink CLI
 * runs it under Node: no window or document, nothing to listen to, and an
 * unsubscribe that does nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { onPageReturn } from "../page-return";

describe("onPageReturn under Node", () => {
  it("listens to nothing and unsubscribes quietly", () => {
    expect(typeof document).toBe("undefined");
    const onReturn = vi.fn();
    expect(() => onPageReturn(onReturn)()).not.toThrow();
    expect(onReturn).not.toHaveBeenCalled();
  });
});
