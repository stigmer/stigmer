/**
 * Pins the desktop's runner adapter: a session opened or closed in the SDK
 * reaches the embedded runner's addSession/removeSession, and the adapter
 * keeps one identity across renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useTauriRunnerAdapter } from "../useTauriRunnerAdapter";

const mockAddSession = vi.fn().mockResolvedValue("task-queue-1");
const mockRemoveSession = vi.fn().mockResolvedValue(undefined);
const mockUpdateRunnerToken = vi.fn().mockResolvedValue(undefined);

vi.mock("../EmbeddedRunnerContext", () => ({
  useRunner: () => ({
    isRunning: true,
    activeSessions: [],
    addSession: mockAddSession,
    removeSession: mockRemoveSession,
    updateRunnerToken: mockUpdateRunnerToken,
    error: null,
  }),
}));

describe("useTauriRunnerAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a RunnerAdapter with both session methods", () => {
    const { result } = renderHook(() => useTauriRunnerAdapter());
    const adapter = result.current;

    expect(adapter.onSessionOpened).toBeInstanceOf(Function);
    expect(adapter.onSessionClosed).toBeInstanceOf(Function);
  });

  it("onSessionOpened delegates to addSession", async () => {
    const { result } = renderHook(() => useTauriRunnerAdapter());
    await result.current.onSessionOpened("ses-123");

    expect(mockAddSession).toHaveBeenCalledTimes(1);
    expect(mockAddSession).toHaveBeenCalledWith("ses-123");
  });

  it("onSessionClosed delegates to removeSession", async () => {
    const { result } = renderHook(() => useTauriRunnerAdapter());
    await result.current.onSessionClosed("ses-123");

    expect(mockRemoveSession).toHaveBeenCalledTimes(1);
    expect(mockRemoveSession).toHaveBeenCalledWith("ses-123");
  });

  it("adapter reference is stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useTauriRunnerAdapter());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
