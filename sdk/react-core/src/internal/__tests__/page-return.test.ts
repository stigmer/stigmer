/**
 * Proves onPageReturn (../page-return.ts): it calls back when the tab is
 * shown or the network returns, not when the tab is hidden, and nothing
 * after the unsubscribe.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { onPageReturn } from "../page-return";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onPageReturn", () => {
  it("calls back when the tab is shown or the network returns", () => {
    const onReturn = vi.fn();
    const stop = onPageReturn(onReturn);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    expect(onReturn).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores the tab being hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const onReturn = vi.fn();
    const stop = onPageReturn(onReturn);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onReturn).not.toHaveBeenCalled();
    stop();
  });

  it("calls nothing after the unsubscribe", () => {
    const onReturn = vi.fn();
    onPageReturn(onReturn)();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    expect(onReturn).not.toHaveBeenCalled();
  });
});
