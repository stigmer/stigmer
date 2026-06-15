import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { UsageError } from "../errors/index.js";
import {
  formatAgentPhase,
  formatWorkflowPhase,
  isAgentExecutionId,
  isExecutionAlias,
  isTerminalAgentPhase,
  isWorkflowExecutionId,
  renderExecutionList,
  resolveExecutionType,
} from "./execution.js";

describe("isAgentExecutionId", () => {
  it.each([
    ["aex_01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["aex-01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["aex_", true],
    ["AEX_run", false], // case-sensitive
    ["agt_abc", false], // different kind
    ["wex_run", false], // workflow, not agent
  ])("%j -> %s", (ref, expected) => {
    expect(isAgentExecutionId(ref)).toBe(expected);
  });
});

describe("isWorkflowExecutionId", () => {
  it.each([
    ["wex_run456", true],
    ["wex-run456", true],
    ["WEX_run", false],
    ["wfl_abc", false],
    ["aex_run", false],
  ])("%j -> %s", (ref, expected) => {
    expect(isWorkflowExecutionId(ref)).toBe(expected);
  });
});

describe("isExecutionAlias", () => {
  it.each([
    ["execution", true],
    ["executions", true],
    ["exec", true],
    ["  Exec  ", true],
    ["agent", false],
    ["session", false],
  ])("%j -> %s", (type, expected) => {
    expect(isExecutionAlias(type)).toBe(expected);
  });
});

describe("resolveExecutionType", () => {
  it("resolves agent and workflow prefixes", () => {
    expect(resolveExecutionType("aex_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("agent");
    expect(resolveExecutionType("wex_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("workflow");
  });

  it("throws a usage error on an unrecognized prefix", () => {
    expect(() => resolveExecutionType("xyz_123")).toThrow(UsageError);
  });
});

describe("renderExecutionList", () => {
  const list = create(AgentExecutionListSchema, {
    totalPages: 1,
    entries: [
      create(AgentExecutionSchema, {
        metadata: { id: "aex_1" },
        spec: { agentId: "agt_1" },
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS, startedAt: "2026-03-01T10:00:00Z" },
      }),
    ],
  });
  const result = { schema: AgentExecutionListSchema, message: list };

  it("renders the full list envelope as protojson for json", () => {
    const json = JSON.parse(renderExecutionList(result, "json", "agent"));
    expect(json.total_pages).toBe(1);
    expect(json.entries[0].metadata.id).toBe("aex_1");
  });

  it("renders a table with a friendly phase label", () => {
    const table = renderExecutionList(result, "table", "agent");
    expect(table).toContain("AGENT");
    expect(table).toContain("aex_1");
    expect(table).toContain("in-progress");
  });
});

describe("formatAgentPhase", () => {
  it.each([
    [ExecutionPhase.EXECUTION_PENDING, "pending"],
    [ExecutionPhase.EXECUTION_IN_PROGRESS, "running"],
    [ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, "awaiting-approval"],
    [ExecutionPhase.EXECUTION_PAUSED, "paused"],
    [ExecutionPhase.EXECUTION_COMPLETED, "completed"],
    [ExecutionPhase.EXECUTION_FAILED, "failed"],
    [ExecutionPhase.EXECUTION_CANCELLED, "cancelled"],
    [ExecutionPhase.EXECUTION_TERMINATED, "terminated"],
    [ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (phase, expected) => {
    expect(formatAgentPhase(phase)).toBe(expected);
  });
});

describe("formatWorkflowPhase", () => {
  it.each([
    [WorkflowExecutionPhase.EXECUTION_PENDING, "pending"],
    [WorkflowExecutionPhase.EXECUTION_IN_PROGRESS, "running"],
    [WorkflowExecutionPhase.EXECUTION_COMPLETED, "completed"],
    [WorkflowExecutionPhase.EXECUTION_FAILED, "failed"],
    [WorkflowExecutionPhase.EXECUTION_CANCELLED, "cancelled"],
    [WorkflowExecutionPhase.EXECUTION_TERMINATED, "terminated"],
    [WorkflowExecutionPhase.EXECUTION_PAUSED, "paused"],
    [WorkflowExecutionPhase.EXECUTION_PHASE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (phase, expected) => {
    expect(formatWorkflowPhase(phase)).toBe(expected);
  });
});

describe("isTerminalAgentPhase", () => {
  it.each([
    [ExecutionPhase.EXECUTION_COMPLETED, true],
    [ExecutionPhase.EXECUTION_FAILED, true],
    [ExecutionPhase.EXECUTION_CANCELLED, true],
    [ExecutionPhase.EXECUTION_TERMINATED, true],
    [ExecutionPhase.EXECUTION_IN_PROGRESS, false],
    [ExecutionPhase.EXECUTION_PAUSED, false],
    [ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, false],
  ])("%s -> %s", (phase, expected) => {
    expect(isTerminalAgentPhase(phase)).toBe(expected);
  });
});
