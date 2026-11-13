/**
 * SetupProgress is the one live line a turn shows before the agent's first
 * words, and it says only what the run records: the server's phase while
 * the run starts, else "Starting"; "Thinking" once the run waits on its
 * first words. Nothing cycles on a timer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SetupProgress } from "../SetupProgress";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SetupProgress, the line before the first words", () => {
  it("says the server's phase while the run starts", () => {
    render(<SetupProgress serverPhase="Waiting for a sandbox" />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Waiting for a sandbox");
    expect(screen.getByText("Waiting for a sandbox")).toBeTruthy();
  });

  it("says Starting when the server sends no phase, and no invented phase as time passes", () => {
    vi.useFakeTimers();
    render(<SetupProgress />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Starting");
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Starting");
    expect(document.body.textContent).not.toMatch(/Initializing|workspace|environment|Almost ready/);
  });

  it("says Thinking once the run waits on its first words, over any phase", () => {
    render(<SetupProgress serverPhase="cloning" isAwaitingResponse />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Thinking");
  });
});
