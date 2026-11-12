/**
 * Pins the journey card's Hide as a per-viewer convenience: remembered in
 * this browser for one organization, read back by that organization only;
 * no organization reads and writes nothing; storage that throws reads as
 * "not hidden" and writes nothing, so the card shows rather than vanish for
 * a reason nobody chose; and the hook reads another organization's choice
 * when the organization changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { JOURNEY_HIDDEN_STORAGE_KEY, readJourneyHidden, rememberJourneyHidden, useJourneyHidden } from "../journeyHidden";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

/** Makes every storage read and write throw, as a blocked or private window may. */
function blockStorage(): void {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("blocked");
  });
}

describe("journeyHidden", () => {
  it("remembers Hide for one organization, read back by that organization only", () => {
    rememberJourneyHidden("org_acme");

    expect(window.localStorage.getItem(`${JOURNEY_HIDDEN_STORAGE_KEY}:org_acme`)).toBe("1");
    expect(readJourneyHidden("org_acme")).toBe(true);
    expect(readJourneyHidden("org_other")).toBe(false);
  });

  it("reads and writes nothing for no organization", () => {
    rememberJourneyHidden("");

    expect(window.localStorage.length).toBe(0);
    expect(readJourneyHidden("")).toBe(false);
  });

  it("reads blocked storage as not hidden, and writes nothing to it", () => {
    blockStorage();

    expect(readJourneyHidden("org_acme")).toBe(false);
    expect(() => rememberJourneyHidden("org_acme")).not.toThrow();
  });

  it("hides for the visit when storage is blocked, and reads another organization's choice when the organization changes", () => {
    window.localStorage.setItem(`${JOURNEY_HIDDEN_STORAGE_KEY}:org_other`, "1");
    const { result, rerender } = renderHook(({ org }: { org: string }) => useJourneyHidden(org), { initialProps: { org: "org_acme" } });
    expect(result.current.hidden).toBe(false);

    rerender({ org: "org_other" });
    expect(result.current.hidden).toBe(true);

    rerender({ org: "org_acme" });
    blockStorage();
    act(() => result.current.hide());
    expect(result.current.hidden).toBe(true);
  });
});
