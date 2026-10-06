/**
 * useUpdateWorkflowExecutionVisibility sends the workflow's id and the
 * chosen level to `workflow.updateExecutionVisibility`, resolves with the
 * updated workflow, and keeps a refusal as its error until the caller
 * clears it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { UpdateWorkflowRunVisibilityInput } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/io_pb";
import { StigmerContext } from "../../context";
import { useUpdateWorkflowExecutionVisibility } from "../useUpdateWorkflowExecutionVisibility";

afterEach(cleanup);

const UPDATED = { metadata: { id: "wfl_1" } } as Workflow;

function renderUpdate(
  update: (input: UpdateWorkflowRunVisibilityInput) => Promise<Workflow>,
) {
  const client = { workflow: { updateExecutionVisibility: vi.fn(update) } };
  const view = renderHook(() => useUpdateWorkflowExecutionVisibility(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    ),
  });
  return { ...view, update: client.workflow.updateExecutionVisibility };
}

describe("useUpdateWorkflowExecutionVisibility", () => {
  it("updates by the workflow's id and resolves with the updated workflow", async () => {
    const { result, update } = renderUpdate(async () => UPDATED);

    let updated: Workflow | undefined;
    await act(async () => {
      updated = await result.current.updateExecutionVisibility(
        "wfl_1",
        WorkflowRunVisibility.organization,
      );
    });

    expect(updated).toBe(UPDATED);
    const input = update.mock.calls[0]![0];
    expect(input.resourceId).toBe("wfl_1");
    expect(input.runVisibility).toBe(WorkflowRunVisibility.organization);
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps a refusal as its error, rethrows it, and drops it when cleared", async () => {
    const { result } = renderUpdate(async () => {
      throw new Error("permission denied");
    });

    await act(async () => {
      await expect(
        result.current.updateExecutionVisibility("wfl_1", WorkflowRunVisibility.organization),
      ).rejects.toThrow("permission denied");
    });

    expect(result.current.error?.message).toBe("permission denied");
    expect(result.current.isUpdating).toBe(false);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
