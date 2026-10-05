// Pins which definition useWorkflowExecutionGraph draws a run from, read
// off the run's own workflow id: the workflow version the run pinned when
// that version holds YAML; the live workflow, flagged as a fallback, when
// the pinned version is empty or its lookup fails; and the live workflow,
// unflagged, for a run that pinned no version. The client is stubbed; the
// execution and task states are handed in from outside.
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import type { Node } from "@xyflow/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { GetWorkflowVersionInput } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { StigmerContext } from "../../context";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";
import { useWorkflowExecutionGraph } from "../useWorkflowExecutionGraph";

const PINNED_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: source-fixture
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: source-fixture
    version: "0.0.1"
  tasks:
    - name: pinned_step
      kind: set_vars
      task_config:
        variables:
          from: pinned
`;

const LIVE_WORKFLOW = create(WorkflowSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Workflow",
  metadata: { id: "wfl-source", name: "source-fixture", org: "org-1" },
  spec: {
    document: { dsl: "1.0.0", namespace: "test", name: "source-fixture", version: "0.0.1" },
    tasks: [
      {
        name: "live_step",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { from: "live" } },
      },
    ],
  },
});

const NO_TASK_STATES: ReadonlyMap<string, DerivedTaskState> = new Map();

function executionPinning(versionHash: string) {
  return create(WorkflowExecutionSchema, {
    metadata: { id: "wex-source", org: "org-1" },
    spec: { workflowId: "wfl-source" },
    status: { workflowVersionHash: versionHash },
  });
}

function stubClient(getVersion: (input: GetWorkflowVersionInput) => Promise<{ validatedYaml: string }>) {
  const get = vi.fn(async () => LIVE_WORKFLOW);
  const client = { workflow: { get, getVersion: vi.fn(getVersion) } };
  return { client: client as unknown as Stigmer, get, getVersion: client.workflow.getVersion };
}

function renderGraph(client: Stigmer, versionHash: string) {
  return renderHook(
    () =>
      useWorkflowExecutionGraph({
        executionId: "wex-source",
        execution: executionPinning(versionHash),
        taskStates: NO_TASK_STATES,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(StigmerContext.Provider, { value: client }, children),
    },
  );
}

function taskNames(nodes: Node[]): string[] {
  return nodes
    .map((n) => n.data as CanvasTaskNodeData)
    .filter((d) => !d.isSentinel)
    .map((d) => d.taskName);
}

const FALLBACK_NOTICE =
  "Unable to load the pinned workflow version. Showing the current definition as a fallback.";

describe("useWorkflowExecutionGraph — the definition a run is drawn from", () => {
  it("draws the version the run pinned, by the run's workflow id, and never reads the live workflow", async () => {
    const { client, get, getVersion } = stubClient(async () => ({ validatedYaml: PINNED_YAML }));
    const { result } = renderGraph(client, "v-pinned");

    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));

    expect(taskNames(result.current.nodes)).toEqual(["pinned_step"]);
    const input = getVersion.mock.calls[0]![0];
    expect(input.workflowId).toBe("wfl-source");
    expect(input.versionHash).toBe("v-pinned");
    expect(get).not.toHaveBeenCalled();
    expect(result.current.versionResolutionFailed).toBe(false);
    expect(result.current.versionMismatch).toBeNull();
  });

  it("falls back to the live workflow, flagged, when the pinned version holds no YAML", async () => {
    const { client, get } = stubClient(async () => ({ validatedYaml: "" }));
    const { result } = renderGraph(client, "v-empty");

    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));

    expect(taskNames(result.current.nodes)).toEqual(["live_step"]);
    expect(get).toHaveBeenCalledWith("wfl-source");
    expect(result.current.versionResolutionFailed).toBe(true);
    expect(result.current.versionMismatch).toBe(FALLBACK_NOTICE);
  });

  it("falls back to the live workflow, flagged, when the version lookup fails", async () => {
    const { client, get } = stubClient(async () => {
      throw new Error("version lookup failed");
    });
    const { result } = renderGraph(client, "v-gone");

    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));

    expect(taskNames(result.current.nodes)).toEqual(["live_step"]);
    expect(get).toHaveBeenCalledWith("wfl-source");
    expect(result.current.versionResolutionFailed).toBe(true);
    expect(result.current.versionMismatch).toBe(FALLBACK_NOTICE);
    expect(result.current.error).toBeNull();
  });

  it("draws the live workflow, unflagged, for a run that pinned no version", async () => {
    const { client, get, getVersion } = stubClient(async () => ({ validatedYaml: PINNED_YAML }));
    const { result } = renderGraph(client, "");

    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));

    expect(taskNames(result.current.nodes)).toEqual(["live_step"]);
    expect(get).toHaveBeenCalledWith("wfl-source");
    expect(getVersion).not.toHaveBeenCalled();
    expect(result.current.versionResolutionFailed).toBe(false);
  });
});
