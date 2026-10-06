/**
 * Pins useWorkflowRunEventLog: it reads one page of the run's event log by
 * `runId` with its cursor and filters (defaults: page of 100, after
 * sequence 0, every event type, every task) and returns the events,
 * whether more follow, and the highest sequence; a null run asks nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/event_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useWorkflowRunEventLog } from "../useWorkflowRunEventLog";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useWorkflowRunEventLog", () => {
  it("reads the first page of the run's event log with the default cursor and filters", async () => {
    const getEventLog = vi.fn().mockResolvedValue({
      events: [{ sequenceNumber: 1n }, { sequenceNumber: 2n }],
      hasMore: true,
      latestSequence: 2n,
    });
    const { result } = renderHook(() => useWorkflowRunEventLog("wfr_1"), {
      wrapper: wrapper({ workflowRun: { getEventLog } }),
    });

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(getEventLog.mock.calls[0]![0]).toMatchObject({
      runId: "wfr_1",
      afterSequence: 0n,
      eventTypes: [],
      taskName: "",
      pageSize: 100,
    });
    expect(result.current.hasMore).toBe(true);
    expect(result.current.latestSequence).toBe(2n);
  });

  it("passes the caller's cursor and filters", async () => {
    const getEventLog = vi.fn().mockResolvedValue({ events: [], hasMore: false, latestSequence: 0n });
    const { result } = renderHook(
      () =>
        useWorkflowRunEventLog("wfr_1", {
          pageSize: 10,
          afterSequence: 42n,
          eventTypes: [WorkflowEventType.task_started],
          taskName: "build",
        }),
      { wrapper: wrapper({ workflowRun: { getEventLog } }) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getEventLog.mock.calls[0]![0]).toMatchObject({
      runId: "wfr_1",
      afterSequence: 42n,
      eventTypes: [WorkflowEventType.task_started],
      taskName: "build",
      pageSize: 10,
    });
  });

  it("asks nothing for a null run", () => {
    const getEventLog = vi.fn();
    const { result } = renderHook(() => useWorkflowRunEventLog(null), {
      wrapper: wrapper({ workflowRun: { getEventLog } }),
    });
    expect(getEventLog).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
    expect(result.current.latestSequence).toBe(0n);
  });
});
