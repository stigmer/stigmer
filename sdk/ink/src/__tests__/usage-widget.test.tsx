// Pins the terminal usage line: nothing before the session has usage; then
// compact tokens, "(estimated)" when a run was counted from its runner's own
// report, the metered call count only when there is one, and the primary
// model; never a dollar figure. The session usage hook is replaced by a
// fixture so each state renders exactly as the hook would report it.
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import type { UseSessionUsageReturn } from "@stigmer/react";
import { UsageWidget } from "../components/UsageWidget.js";

let usage: Partial<UseSessionUsageReturn>;

vi.mock("@stigmer/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react")>();
  return {
    ...actual,
    useSessionUsage: () => usage as UseSessionUsageReturn,
  };
});

afterEach(() => {
  cleanup();
});

function frame(fixture: Partial<UseSessionUsageReturn>): string {
  usage = fixture;
  return render(<UsageWidget runs={[]} />).lastFrame() ?? "";
}

describe("UsageWidget", () => {
  it("renders nothing before the session has usage", () => {
    expect(frame({ hasUsage: false })).toBe("");
  });

  it("shows metered tokens, calls and the primary model, and no price", () => {
    const out = frame({
      hasUsage: true,
      totalTokens: 18_400,
      llmCallCount: 3,
      primaryModel: "claude-sonnet-4",
      isEstimated: false,
    });
    expect(out).toContain("18.4k tokens · 3 calls · claude-sonnet-4");
    expect(out).not.toContain("estimated");
    expect(out).not.toContain("$");
  });

  it("marks runner-reported tokens as estimated and leaves out a zero call count", () => {
    const out = frame({
      hasUsage: true,
      totalTokens: 1_234_567,
      llmCallCount: 0,
      primaryModel: "",
      isEstimated: true,
    });
    expect(out).toContain("1.2M tokens (estimated)");
    expect(out).not.toContain("call");
  });

  it("names a single call in the singular", () => {
    expect(
      frame({
        hasUsage: true,
        totalTokens: 900,
        llmCallCount: 1,
        primaryModel: "",
        isEstimated: false,
      }),
    ).toContain("900 tokens · 1 call");
  });
});
