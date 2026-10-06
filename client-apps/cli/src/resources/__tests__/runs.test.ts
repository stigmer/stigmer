import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import {
  formatAgentPhase,
  formatWorkflowPhase,
  isAgentRunId,
  isRunAlias,
  isTerminalAgentPhase,
  isWorkflowRunId,
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
