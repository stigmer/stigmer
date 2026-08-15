import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  WorkflowInstanceSchema,
  type WorkflowInstance,
} from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { WorkflowInstanceInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { WorkflowInstanceDetailPanel } from "../instance/WorkflowInstanceDetailPanel";

/**
 * Regression suite for the full-spec-replace wipe bug: before the
 * generated-mapper migration, saving environment edits in this panel
 * silently reset `execution_visibility` (run observability, which has its
 * own dedicated updateExecutionVisibility RPC and control). The panel
 * must spread `toWorkflowInstanceUpdateInput` and override only the
 * environment refs.
 */

const INSTANCE: WorkflowInstance = create(WorkflowInstanceSchema, {
  metadata: {
    id: "wfi-1",
    name: "Nightly Triage",
    slug: "nightly-triage",
    org: "acme",
  },
  spec: {
    workflowId: "wf-1",
    description: "Runs every night.",
    environmentRefs: [
      { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
    ],
    executionVisibility: WorkflowExecutionVisibility.organization,
  },
});

function renderPanel(update: ReturnType<typeof vi.fn>) {
  const client = {
    workflowInstance: { update },
    iamPolicy: {
      checkMyPermission: vi.fn(async () => ({ isAuthorized: true })),
    },
    environment: {
      list: vi.fn(async () => ({ items: [], totalCount: 0 })),
    },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <WorkflowInstanceDetailPanel instance={INSTANCE} org="acme" onClose={() => {}} />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("WorkflowInstanceDetailPanel save payload", () => {
  it("round-trips execution_visibility on an environments-only save (the wipe bug)", async () => {
    const update = vi.fn(async (_input: WorkflowInstanceInput) => INSTANCE);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The wipe-bug guard: run visibility is edited elsewhere and must
    // survive an environment save untouched.
    expect(input.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
    expect(input.workflowId).toBe("wf-1");
    expect(input.description).toBe("Runs every night.");
    // The form-owned field.
    expect(input.environmentRefs).toEqual([{ org: "acme", slug: "prod" }]);
    // Addressing fields.
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("nightly-triage");
  });
});
