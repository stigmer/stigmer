/**
 * Pins the live layer's gate (`live-gate.ts`): a missing key skips outside
 * the live lane and fails inside it, a key's value never reaches a message,
 * and a case's spend lands in the step summary when one is named.
 *
 * These run in the ordinary suite because the rule they pin decides whether
 * the live lane can go quietly green; the live suites themselves run only
 * through `vitest.live.config.ts`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { liveSecret, recordLiveSpend } from "../live-gate.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("liveSecret", () => {
  it("returns the key when it is set, in or out of the lane", () => {
    expect(liveSecret("CURSOR_API_KEY", { CURSOR_API_KEY: "k-1" })).toBe("k-1");
    expect(liveSecret("CURSOR_API_KEY", { CURSOR_API_KEY: "k-1", STIGMER_LIVE: "1" })).toBe("k-1");
  });

  it("returns undefined outside the lane when the key is missing, and says why once per key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(liveSecret("CURSOR_API_KEY", {})).toBeUndefined();
    expect(liveSecret("CURSOR_API_KEY", { CURSOR_API_KEY: "" }), "an empty value is missing").toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/CURSOR_API_KEY is not set/);
  });

  it("throws inside the lane when the key is missing, naming the variable and no value", () => {
    expect(() => liveSecret("CURSOR_API_KEY", { STIGMER_LIVE: "1" })).toThrow(/CURSOR_API_KEY is not set, but STIGMER_LIVE=1/);
  });
});

describe("recordLiveSpend", () => {
  it("appends the case's estimate to the step summary when one is named", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "live-gate-"));
    try {
      const summary = join(dir, "summary.md");
      recordLiveSpend("native plain turn", 0.01234, { GITHUB_STEP_SUMMARY: summary });
      recordLiveSpend("native tool call", 0.02, { GITHUB_STEP_SUMMARY: summary });
      expect(readFileSync(summary, "utf-8")).toBe(
        "- native plain turn: $0.0123 estimated\n- native tool call: $0.0200 estimated\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the estimate when no summary is named", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    recordLiveSpend("cursor transcript", 0.05, {});
    expect(log.mock.calls.flat().join(" ")).toMatch(/cursor transcript: \$0\.0500 estimated/);
  });

  it("says a run reported no estimate rather than reading it as free", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    recordLiveSpend("cursor transcript", undefined, {});
    expect(log.mock.calls.flat().join(" ")).toMatch(/cursor transcript: no estimate reported/);
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/\$0\.0000/);
  });
});
