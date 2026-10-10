/**
 * A composition root's boot that fails after the agent host started
 * (`agent-host/failed-boot.ts`).
 *
 * Pinned:
 *  - a boot that succeeds answers its value and releases nothing;
 *  - a boot that fails releases what it named and rethrows its own error;
 *  - a failure before anything was named releases nothing;
 *  - a release that fails too is logged, and the boot's error is still the
 *    one thrown.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { releasingOnFailure } from "../failed-boot.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("releasing a failed boot", () => {
  it("answers a boot that succeeds and releases nothing", async () => {
    const released: string[] = [];
    const value = await releasingOnFailure(async (boot) => {
      boot.release = async () => void released.push("host");
      return "runner";
    });
    expect(value).toBe("runner");
    expect(released).toEqual([]);
  });

  it("releases what a failed boot named, and rethrows its error", async () => {
    const released: string[] = [];
    await expect(
      releasingOnFailure(async (boot) => {
        boot.release = async () => void released.push("host");
        throw new Error("Temporal is unreachable");
      }),
    ).rejects.toThrow("Temporal is unreachable");
    expect(released).toEqual(["host"]);
  });

  it("releases nothing for a boot that failed before the host started", async () => {
    await expect(releasingOnFailure(async () => Promise.reject(new Error("bad options")))).rejects.toThrow("bad options");
  });

  it("logs a release that fails, and still throws the boot's error", async () => {
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((message: string) => void warned.push(message));
    await expect(
      releasingOnFailure(async (boot) => {
        boot.release = async () => Promise.reject(new Error("the proxy would not close"));
        throw new Error("the worker could not be created");
      }),
    ).rejects.toThrow("the worker could not be created");
    expect(warned).toEqual(["[agent-host] releasing the agent host after a failed boot failed: the proxy would not close"]);
  });
});
