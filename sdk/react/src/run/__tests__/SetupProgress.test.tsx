/**
 * SetupProgress is the one live line a turn shows before the agent's first
 * words, and it says only what the run records: the server's wait for a
 * sandbox while every sandbox is busy ("Waiting for a sandbox · 1m 20s",
 * counting on once a second from the value's arrival, each new value
 * counting from itself, its label naming the wait without the count); else
 * the server's phase while the run starts, else "Starting"; "Thinking" once
 * the run waits on its first words. Nothing else cycles on a timer.
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

  it("says how long the run has waited for a sandbox, counting on, ahead of the server's phase", () => {
    vi.useFakeTimers();
    const { rerender } = render(<SetupProgress serverPhase="Waiting for a sandbox" awaitingSandboxMs={80_000} />);
    expect(screen.getByText("Waiting for a sandbox · 1m 20s")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-label"), "the label names the wait, not each second").toBe("Waiting for a sandbox");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("Waiting for a sandbox · 1m 25s")).toBeTruthy();
    rerender(<SetupProgress serverPhase="Waiting for a sandbox" awaitingSandboxMs={95_000} />);
    expect(screen.getByText("Waiting for a sandbox · 1m 35s"), "a newer measure counts from itself").toBeTruthy();
    rerender(<SetupProgress serverPhase="" />);
    expect(screen.getByText("Starting"), "the wait gone, the line goes back to the phase").toBeTruthy();
  });

  it("says Thinking over a wait the stream still holds", () => {
    render(<SetupProgress awaitingSandboxMs={10_000} isAwaitingResponse />);
    expect(screen.getByText("Thinking")).toBeTruthy();
  });
});
