import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { prefersReducedMotion } from "../motion-preference";

describe("motion-preference", () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  let listeners: Array<(e: { matches: boolean }) => void>;

  beforeEach(() => {
    listeners = [];
    matchMediaMock = vi.fn(() => ({
      matches: false,
      addEventListener: (_event: string, cb: (e: { matches: boolean }) => void) => {
        listeners.push(cb);
      },
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("prefersReducedMotion", () => {
    it("returns boolean", () => {
      const result = prefersReducedMotion();
      expect(typeof result).toBe("boolean");
    });
  });
});
