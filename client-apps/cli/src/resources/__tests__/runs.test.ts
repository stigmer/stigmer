// Unit tests for the run helpers behind `get run`, `list runs` and the `runs`
// group: id-prefix routing (and its usage error), the single-run read routed
// by family, the cursor-paged list reads with the organization they scope to,
// the agent and workflow list tables (friendly phase label, a dash for an
// unset field), and the human phase labels. Reads run against a client double
// that records what it was asked.

import { create, isMessage, type Message } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import {
  WorkflowRunListSchema,
  type ListWorkflowRunsRequest,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import type { ListAgentRunsRequest } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import {
  formatAgentPhase,
  formatWorkflowPhase,
  getRun,
  isAgentRunId,
  isRunAlias,
  isTerminalAgentPhase,
  isWorkflowRunId,
  listAgentRuns,
  listWorkflowRuns,
  renderRunList,
  resolveRunType,
} from "../runs.js";

describe("isAgentRunId", () => {
  it.each([
    ["aex_01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["aex-01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["aex_", true],
    ["AEX_run", false], // case-sensitive
    ["agt_abc", false], // different kind
    ["wex_run", false], // workflow, not agent
  ])("%j -> %s", (ref, expected) => {
    expect(isAgentRunId(ref)).toBe(expected);
  });
});

describe("isWorkflowRunId", () => {
  it.each([
    ["wex_run456", true],
    ["wex-run456", true],
    ["WEX_run", false],
    ["wfl_abc", false],
    ["aex_run", false],
  ])("%j -> %s", (ref, expected) => {
    expect(isWorkflowRunId(ref)).toBe(expected);
  });
});

describe("isRunAlias", () => {
  it.each([
    ["run", true],
    ["runs", true],
    ["  Runs  ", true],
    ["execution", false],
    ["executions", false],
    ["exec", false],
    ["agent", false],
    ["session", false],
  ])("%j -> %s", (type, expected) => {
    expect(isRunAlias(type)).toBe(expected);
  });
});

describe("resolveRunType", () => {
  it("resolves agent and workflow prefixes", () => {
    expect(resolveRunType("aex_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("agent");
    expect(resolveRunType("wex_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("workflow");
  });

  it("throws a usage error on an unrecognized prefix", () => {
    expect(() => resolveRunType("xyz_123")).toThrow(UsageError);
  });
});

describe("renderRunList", () => {
  const list = create(AgentRunListSchema, {
    totalPages: 1,
    entries: [
      create(AgentRunSchema, {
        metadata: { id: "aex_1" },
        status: {
          agentId: "agt_1",
          phase: RunPhase.RUN_IN_PROGRESS,
          startedAt: "2026-03-01T10:00:00Z",
        },
      }),
    ],
  });
  const result = { schema: AgentRunListSchema, message: list };

  it("renders the full list envelope as protojson for json", () => {
    const json = JSON.parse(renderRunList(result, "json", "agent"));
    expect(json.total_pages).toBe(1);
    expect(json.entries[0].metadata.id).toBe("aex_1");
  });

  it("renders a table with a friendly phase label", () => {
    const table = renderRunList(result, "table", "agent");
    expect(table).toContain("AGENT");
    expect(table).toContain("aex_1");
    // The agent column is the agent the turn ran, as the server recorded it.
    expect(table).toContain("agt_1");
    expect(table).toContain("in-progress");
  });
});

describe("renderRunList for workflow runs", () => {
  const list = create(WorkflowRunListSchema, {
    entries: [
      create(WorkflowRunSchema, {
        metadata: { id: "wex_1" },
        spec: { workflowId: "wfl_nightly" },
        status: { phase: WorkflowRunPhase.RUN_COMPLETED, startedAt: "2026-03-01T10:00:00Z" },
      }),
      // Nothing recorded yet: every unset column is a dash.
      create(WorkflowRunSchema, { metadata: { id: "wex_2" } }),
    ],
  });
  const table = renderRunList({ schema: WorkflowRunListSchema, message: list }, "table", "workflow");

  it("renders the workflow column and the friendly phase", () => {
    expect(table).toContain("WORKFLOW");
    expect(table).not.toContain("AGENT");
    expect(table).toMatch(/wex_1\s+wfl_nightly\s+completed\s+2026-03-01T10:00:00Z/);
  });

  it("renders a dash for an unset workflow, phase and start", () => {
    expect(table).toMatch(/wex_2\s+-\s+-\s+-/);
  });
});

/** Two list pages per family, recording each request. */
function listingClient(): {
  client: Stigmer;
  agentRequests: ListAgentRunsRequest[];
  workflowRequests: ListWorkflowRunsRequest[];
} {
  const agentRequests: ListAgentRunsRequest[] = [];
  const workflowRequests: ListWorkflowRunsRequest[] = [];
  const page = <T>(entries: T[], token: string) => ({ entries, nextPageToken: token });
  const client = {
    agentRun: {
      list: async (req: ListAgentRunsRequest) => {
        agentRequests.push(req);
        return req.pageToken === ""
          ? page([create(AgentRunSchema, { metadata: { id: "aex_1" } })], "p2")
          : page([create(AgentRunSchema, { metadata: { id: "aex_2" } })], "");
      },
      get: async (id: string) => create(AgentRunSchema, { metadata: { id } }),
    },
    workflowRun: {
      list: async (req: ListWorkflowRunsRequest) => {
        workflowRequests.push(req);
        return req.pageToken === ""
          ? page([create(WorkflowRunSchema, { metadata: { id: "wex_1" } })], "p2")
          : page([create(WorkflowRunSchema, { metadata: { id: "wex_2" } })], "");
      },
      get: async (id: string) => create(WorkflowRunSchema, { metadata: { id } }),
    },
  } as unknown as Stigmer;
  return { client, agentRequests, workflowRequests };
}

/** The run ids a run read or list result holds, in order. */
function runIds(message: Message): string[] {
  if (isMessage(message, AgentRunListSchema)) return message.entries.map((e) => e.metadata?.id ?? "");
  if (isMessage(message, WorkflowRunListSchema)) return message.entries.map((e) => e.metadata?.id ?? "");
  if (isMessage(message, AgentRunSchema) || isMessage(message, WorkflowRunSchema)) return [message.metadata?.id ?? ""];
  throw new Error(`not a run message: ${message.$typeName}`);
}

describe("getRun", () => {
  it("reads an agent run through the agent controller, with its schema", async () => {
    const { client } = listingClient();
    const result = await getRun(client, "aex_9");
    expect(result.schema).toBe(AgentRunSchema);
    expect(runIds(result.message)).toEqual(["aex_9"]);
  });

  it("reads a workflow run through the workflow controller, with its schema", async () => {
    const { client } = listingClient();
    const result = await getRun(client, "wex_9");
    expect(result.schema).toBe(WorkflowRunSchema);
    expect(runIds(result.message)).toEqual(["wex_9"]);
  });
});

describe("listAgentRuns / listWorkflowRuns", () => {
  it("reads agent run pages until the limit, scoped to the organization", async () => {
    const { client, agentRequests } = listingClient();
    const result = await listAgentRuns(client, 2, "acme");
    expect(result.schema).toBe(AgentRunListSchema);
    expect(runIds(result.message)).toEqual(["aex_1", "aex_2"]);
    expect(agentRequests.map((r) => [r.pageSize, r.pageToken, r.org])).toEqual([
      [2, "", "acme"],
      [1, "p2", "acme"],
    ]);
  });

  it("reads workflow run pages until the limit, scoped to the organization", async () => {
    const { client, workflowRequests } = listingClient();
    const result = await listWorkflowRuns(client, 2, "acme");
    expect(result.schema).toBe(WorkflowRunListSchema);
    expect(runIds(result.message)).toEqual(["wex_1", "wex_2"]);
    expect(workflowRequests.map((r) => [r.pageSize, r.pageToken, r.org])).toEqual([
      [2, "", "acme"],
      [1, "p2", "acme"],
    ]);
  });

  it("stops at the limit and names no organization by default", async () => {
    const { client, workflowRequests } = listingClient();
    const result = await listWorkflowRuns(client, 1);
    expect(runIds(result.message)).toEqual(["wex_1"]);
    expect(workflowRequests.map((r) => r.org)).toEqual([""]);
  });
});

describe("formatAgentPhase", () => {
  it.each([
    [RunPhase.RUN_PENDING, "pending"],
    [RunPhase.RUN_IN_PROGRESS, "running"],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, "awaiting-approval"],
    [RunPhase.RUN_PAUSED, "paused"],
    [RunPhase.RUN_COMPLETED, "completed"],
    [RunPhase.RUN_FAILED, "failed"],
    [RunPhase.RUN_CANCELLED, "cancelled"],
    [RunPhase.RUN_TERMINATED, "terminated"],
    [RunPhase.RUN_PHASE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (phase, expected) => {
    expect(formatAgentPhase(phase)).toBe(expected);
  });
});

describe("formatWorkflowPhase", () => {
  it.each([
    [WorkflowRunPhase.RUN_PENDING, "pending"],
    [WorkflowRunPhase.RUN_IN_PROGRESS, "running"],
    [WorkflowRunPhase.RUN_COMPLETED, "completed"],
    [WorkflowRunPhase.RUN_FAILED, "failed"],
    [WorkflowRunPhase.RUN_CANCELLED, "cancelled"],
    [WorkflowRunPhase.RUN_TERMINATED, "terminated"],
    [WorkflowRunPhase.RUN_PAUSED, "paused"],
    [WorkflowRunPhase.RUN_PHASE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (phase, expected) => {
    expect(formatWorkflowPhase(phase)).toBe(expected);
  });
});

describe("isTerminalAgentPhase", () => {
  it.each([
    [RunPhase.RUN_COMPLETED, true],
    [RunPhase.RUN_FAILED, true],
    [RunPhase.RUN_CANCELLED, true],
    [RunPhase.RUN_TERMINATED, true],
    [RunPhase.RUN_IN_PROGRESS, false],
    [RunPhase.RUN_PAUSED, false],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, false],
  ])("%s -> %s", (phase, expected) => {
    expect(isTerminalAgentPhase(phase)).toBe(expected);
  });
});
