/**
 * Pins RunActiveTaskIndicator: the pill's label for a running task, a
 * fork's parallel count and a task awaiting approval (its tool's name when
 * known); the live elapsed counter, which ticks only while the task runs;
 * the screen-reader announcement; and the two buttons, the pill jumping to
 * the task and the follow toggle reporting its pressed state.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ActiveTaskInfo } from "../useActiveTaskName";
import { RunActiveTaskIndicator } from "../RunActiveTaskIndicator";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function task(overrides: Partial<ActiveTaskInfo> = {}): ActiveTaskInfo {
  return {
    taskName: "build-report",
    status: "running",
    durationMs: 2_000,
    agentSlug: "",
    currentToolName: "",
    concurrentCount: 1,
    ...overrides,
  };
}

function renderIndicator(activeTask: ActiveTaskInfo, isFollowing = false) {
  const onFollowToggle = vi.fn();
  const onJumpToTask = vi.fn();
  render(
    <RunActiveTaskIndicator
      activeTask={activeTask}
      isFollowing={isFollowing}
      onFollowToggle={onFollowToggle}
      onJumpToTask={onJumpToTask}
    />,
  );
  return { onFollowToggle, onJumpToTask };
}

describe("RunActiveTaskIndicator", () => {
  it("names the running task, counts its elapsed time up, and announces it", () => {
    vi.useFakeTimers();
    renderIndicator(task());

    expect(screen.getByText("Running: build-report")).toBeTruthy();
    expect(screen.getByText("2.0s")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Now running: build-report");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("5.0s")).toBeTruthy();
  });

  it("counts the parallel branches of a fork", () => {
    renderIndicator(task({ concurrentCount: 3 }));
    expect(screen.getByText("Running: build-report (+2 parallel)")).toBeTruthy();
  });

  it("names the tool awaiting approval, and does not tick while waiting", () => {
    vi.useFakeTimers();
    renderIndicator(task({ status: "waiting_approval", currentToolName: "shell" }));

    expect(screen.getByText("Awaiting approval: shell")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Approval required for shell");
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("2.0s")).toBeTruthy();
  });

  it("falls back to the task name for an approval without a tool, and hides a zero elapsed time", () => {
    renderIndicator(task({ status: "waiting_approval", durationMs: 0 }));
    expect(screen.getByText("Awaiting approval: build-report")).toBeTruthy();
    expect(screen.queryByText("0ms")).toBeNull();
  });

  it("jumps to the task from the pill and toggles following from its button", () => {
    const { onFollowToggle, onJumpToTask } = renderIndicator(task());

    fireEvent.click(screen.getByText("Running: build-report"));
    expect(onJumpToTask).toHaveBeenCalledTimes(1);

    const follow = screen.getByRole("button", { name: "Follow active task" });
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(follow);
    expect(onFollowToggle).toHaveBeenCalledTimes(1);
  });

  it("offers to stop following while following", () => {
    renderIndicator(task(), true);
    const follow = screen.getByRole("button", { name: "Stop following active task" });
    expect(follow.getAttribute("aria-pressed")).toBe("true");
  });
});
