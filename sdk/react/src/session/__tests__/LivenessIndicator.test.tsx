import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { TurnLiveness } from "@stigmer/client";
import { LIVENESS_SHOW_AFTER_MS, LivenessIndicator, livenessLabel, spanWords } from "../LivenessIndicator";

// ---------------------------------------------------------------------------
// The liveness strip's words: the oldest open operation by its tool's name
// and age ("and N more" beside it), else the wait on the model, nothing
// before the show threshold, and ages that tick on from the preview's
// arrival on this clock.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const shell = (elapsedMs: number) => ({ toolUseId: "run_1.c1", name: "run_shell", threadId: "", elapsedMs });

describe("livenessLabel", () => {
  it("names the oldest open operation and its age, and how many run beside it", () => {
    expect(livenessLabel({ operations: [shell(14 * 60_000)], awaitingModelMs: undefined }, 0)).toBe("Running Run Shell · 14 min");
    expect(
      livenessLabel({ operations: [shell(90_000), { ...shell(5_000), toolUseId: "run_1.c2" }, { ...shell(1), toolUseId: "run_1.c3" }], awaitingModelMs: 3 }, 0),
    ).toBe("Running Run Shell and 2 more · 1 min");
  });

  it("says the turn waits on its model when nothing is open", () => {
    expect(livenessLabel({ operations: [], awaitingModelMs: 120_000 }, 0)).toBe("Waiting on the model · 2 min");
  });

  it("says nothing before the threshold, or when nothing is open and nothing waits", () => {
    expect(livenessLabel({ operations: [shell(LIVENESS_SHOW_AFTER_MS - 1)], awaitingModelMs: undefined }, 0)).toBeUndefined();
    expect(livenessLabel({ operations: [], awaitingModelMs: 1_000 }, 0)).toBeUndefined();
    expect(livenessLabel({ operations: [], awaitingModelMs: undefined }, 60_000)).toBeUndefined();
    expect(livenessLabel({ operations: [shell(LIVENESS_SHOW_AFTER_MS - 1)], awaitingModelMs: undefined }, 1)).toBe("Running Run Shell · 10 s");
  });
});

describe("spanWords", () => {
  it("says seconds, minutes, then hours and minutes", () => {
    expect(spanWords(59_999)).toBe("59 s");
    expect(spanWords(60_000)).toBe("1 min");
    expect(spanWords(3_600_000)).toBe("1 h");
    expect(spanWords(3_900_000)).toBe("1 h 5 min");
  });
});

describe("LivenessIndicator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks on from the preview's arrival, and starts over from a newer one", () => {
    const first: TurnLiveness = { operations: [shell(59_000)], awaitingModelMs: undefined };
    const { rerender } = render(<LivenessIndicator liveness={first} />);
    expect(screen.getByRole("status").textContent).toBe("Running Run Shell · 59 s");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByRole("status").textContent).toBe("Running Run Shell · 1 min");

    rerender(<LivenessIndicator liveness={{ operations: [], awaitingModelMs: 30_000 }} />);
    expect(screen.getByRole("status").textContent).toBe("Waiting on the model · 30 s");
  });

  it("renders nothing until something has run past the threshold", () => {
    render(<LivenessIndicator liveness={{ operations: [shell(1_000)], awaitingModelMs: undefined }} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(LIVENESS_SHOW_AFTER_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("Running Run Shell · 11 s");
  });
});
