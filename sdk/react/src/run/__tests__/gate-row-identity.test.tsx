/**
 * A waiting tool call's row stays the same element while the thread settles
 * and re-renders (stigmer/stigmer#1570). A gated write is a new thread item,
 * so it mounts inside the enter animation's wrapper; the animation ending, by
 * its event or by the wrapper's fallback timer, and a re-render with
 * refetched props (new object identities, as a run refetch makes them) must
 * neither replace the row nor drop the keyboard focus a person put on Allow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Stigmer, Turn } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { MessageThread } from "../MessageThread";
import { asked, conversation, status, use } from "./__fixtures__/thread-events";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
      root: null,
      rootMargin: "",
      thresholds: [0],
    })),
  );
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const CLIENT = {} as Stigmer;

/**
 * A live turn waiting on a gated `write_file`, built fresh on every call: each
 * call returns new turn and run objects for the same events, as a refetch does.
 */
function gatedWrite(): { turns: readonly Turn[]; runs: Run[] } {
  return conversation({
    id: "w",
    phase: "running",
    message: "Please write the file.",
    extra: [use("w", "c1", "write_file", { path: "/tmp/a.txt", content: "alpha\n" }, { ask: true }), asked("w", "c1"), status("w", "waiting")],
  });
}

function thread(conv: { turns: readonly Turn[]; runs: Run[] }) {
  return (
    <StigmerContext.Provider value={CLIENT}>
      <MessageThread turns={conv.turns} runs={conv.runs} onAnswerToolUse={() => {}} />
    </StigmerContext.Provider>
  );
}

function gateRow(): HTMLElement {
  const approve = screen.getByRole("button", { name: "Allow" });
  const row = approve.closest<HTMLElement>('[data-cursor-target="tool-call-row"]');
  expect(row).not.toBeNull();
  return row!;
}

describe("the approval gate's row across the thread settling (stigmer/stigmer#1570)", () => {
  it("stays the same element, focus on Allow kept, when the enter animation ends and the page refetches", () => {
    const { container, rerender } = render(thread(gatedWrite()));
    const row = gateRow();
    const approve = screen.getByRole("button", { name: "Allow" });
    approve.focus();
    expect(document.activeElement).toBe(approve);

    for (const entering of container.querySelectorAll(".stgm-thread-item-enter")) {
      fireEvent.animationEnd(entering);
    }
    rerender(thread(gatedWrite()));

    expect(container.querySelector(".stgm-thread-item-enter")).toBeNull();
    expect(gateRow()).toBe(row);
    expect(screen.getByRole("button", { name: "Allow" })).toBe(approve);
    expect(row.isConnected).toBe(true);
    expect(document.activeElement).toBe(approve);
  });

  it("stays the same element when the wrapper's fallback timer ends the entrance", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(thread(gatedWrite()));
    const row = gateRow();
    const approve = screen.getByRole("button", { name: "Allow" });
    approve.focus();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender(thread(gatedWrite()));

    expect(container.querySelector(".stgm-thread-item-enter")).toBeNull();
    expect(gateRow()).toBe(row);
    expect(document.activeElement).toBe(approve);
  });
});
