import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useTauriRunnerAdapter } from "../useTauriRunnerAdapter";

const mockAddSession = vi.fn().mockResolvedValue("task-queue-1");
const mockRemoveSession = vi.fn().mockResolvedValue(undefined);
const mockAddWorkflowExecution = vi.fn().mockResolvedValue("task-queue-2");
const mockRemoveWorkflowExecution = vi.fn().mockResolvedValue(undefined);
const mockUpdateRunnerToken = vi.fn().mockResolvedValue(undefined);

vi.mock("../EmbeddedRunnerContext", () => ({
  useRunner: () => ({
    isRunning: true,
    activeSessions: [],
    activeWorkflowExecutions: [],
    addSession: mockAddSession,
    removeSession: mockRemoveSession,
    addWorkflowExecution: mockAddWorkflowExecution,
    removeWorkflowExecution: mockRemoveWorkflowExecution,
    updateRunnerToken: mockUpdateRunnerToken,
    error: null,
  }),
}));

describe("useTauriRunnerAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a RunnerAdapter with all four methods", () => {
    const { result } = renderHook(() => useTauriRunnerAdapter());
    const adapter = result.current;

    expect(adapter.onSessionOpened).toBeInstanceOf(Function);
    expect(adapter.onSessionClosed).toBeInstanceOf(Function);
    expect(adapter.onWorkflowExecutionCreated).toBeInstanceOf(Function);
    expect(adapter.onWorkflowExecutionTerminated).toBeInstanceOf(Function);
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

  it("onWorkflowExecutionCreated delegates to addWorkflowExecution", async () => {
    const { result } = renderHook(() => useTauriRunnerAdapter());
    await result.current.onWorkflowExecutionCreated("wfexec-456");

    expect(mockAddWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(mockAddWorkflowExecution).toHaveBeenCalledWith("wfexec-456");
  });

  it("onWorkflowExecutionTerminated delegates to removeWorkflowExecution", async () => {
    const { result } = renderHook(() => useTauriRunnerAdapter());
    await result.current.onWorkflowExecutionTerminated("wfexec-456");

    expect(mockRemoveWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(mockRemoveWorkflowExecution).toHaveBeenCalledWith("wfexec-456");
  });

  it("adapter reference is stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useTauriRunnerAdapter());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
