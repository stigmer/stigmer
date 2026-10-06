/**
 * Pins what the run zone says when reading a run failed for a reason other
 * than its absence: it says the run failed to load and why, and its retry
 * reads the run again.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RunLoadFailed } from "../RunLoadFailed";

describe("RunLoadFailed", () => {
  it("says the run failed to load and retries on request", () => {
    const onRetry = vi.fn();
    render(<RunLoadFailed error={new Error("connection refused")} onRetry={onRetry} />);

    expect(screen.getByRole("heading", { name: "Failed to load run" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
