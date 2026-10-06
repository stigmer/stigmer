/**
 * The run JSON that crosses Temporal is decoded from what an older server
 * or runner wrote: a local activity's result is replayed from history, and
 * an activity's input or a runner's result was recorded before the deploy.
 * Pins that:
 *
 * - names retired by the rename of executions to runs (field JSON names,
 *   enum value names, the kind string) read as their current names, fed
 *   the JSON the replay histories record, while a free-form string that
 *   happens to spell a retired name is left as written;
 * - the workflow's load still drops a reserved enum name or an unknown
 *   field, keeping everything else;
 * - a field set under both its retired and its current name is refused,
 *   not decided by its place in the payload;
 * - the runner result's phase lookup reads a retired phase name;
 * - the retired-names tables hold exactly the run-named fields and enum
 *   values of the messages that cross Temporal, each from its name before
 *   the rename, so they cannot drift from the contract.
 */
import { describe, expect, it } from "vitest";
import {
  ApprovalPolicySource,
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";

import type { DescMessage } from "@bufbuild/protobuf";
import { AgentRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { WorkflowRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";

import {
  RETIRED_ENUM_VALUE_NAMES,
  RETIRED_FIELD_NAMES,
  decodeLoadedExecution,
  renameRetiredRunJson,
} from "../execution-json.js";
import { getPhaseFromResult } from "../runner-result.js";

describe("decodeLoadedExecution", () => {
  it("reads the load result a replay history records, written before the run rename", () => {
    // hitl-approval.json's LoadAgentExecution marker result, with the kind
    // string and two renamed fields an older server also wrote.
    const execution = decodeLoadedExecution({
      kind: "AgentExecution",
      metadata: { id: "exec-replay" },
      spec: { supersedesExecutionId: "aex_prev" },
      status: {
        phase: "EXECUTION_WAITING_FOR_APPROVAL",
        pendingApprovals: [{ toolCallId: "tc-1", toolName: "echo" }],
        subAgentExecutions: [{ id: "sub_1", name: "researcher" }],
        messages: [{ content: "EXECUTION_COMPLETED is a phase name" }],
      },
    });
    expect(execution.kind).toBe("AgentRun");
    expect(execution.metadata?.id).toBe("exec-replay");
    expect(execution.spec?.supersedesRunId).toBe("aex_prev");
    expect(execution.status?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(execution.status?.pendingApprovals[0]?.toolCallId).toBe("tc-1");
    expect(execution.status?.subAgentRuns[0]?.name).toBe("researcher");
    expect(execution.status?.messages[0]?.content).toBe("EXECUTION_COMPLETED is a phase name");
  });

  it("decodes a tool call carrying a reserved provenance name as UNSPECIFIED, keeping the rest", () => {
    const execution = decodeLoadedExecution({
      metadata: { id: "aex_1" },
      status: {
        messages: [
          {
            toolCalls: [
              {
                id: "call_1",
                name: "search_issues",
                status: "TOOL_CALL_COMPLETED",
                approvalPolicySource: "APPROVAL_POLICY_SOURCE_CLASSIFIER_DEFAULT",
              },
            ],
          },
        ],
      },
    });
    const call = execution.status?.messages[0]?.toolCalls[0];
    expect(execution.metadata?.id).toBe("aex_1");
    expect(call?.name).toBe("search_issues");
    expect(call?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(call?.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
  });

  it("walks map fields: a message value is renamed inside, a scalar value is kept", () => {
    const execution = decodeLoadedExecution({
      metadata: { id: "aex_3", labels: { phase: "EXECUTION_COMPLETED" } },
      status: {
        todos: {
          t1: { id: "t1", content: "EXECUTION_COMPLETED stays text", status: "TODO_STATUS_PENDING" },
        },
      },
    });
    expect(execution.metadata?.labels).toEqual({ phase: "EXECUTION_COMPLETED" });
    expect(execution.status?.todos["t1"]?.content).toBe("EXECUTION_COMPLETED stays text");
  });

  it("leaves a value that is not the shape its field declares to the decoder", () => {
    expect(renameRetiredRunJson(AgentRunSchema, "not an object")).toBe("not an object");
    expect(renameRetiredRunJson(AgentRunSchema, { status: ["not", "an", "object"] })).toEqual({
      status: ["not", "an", "object"],
    });
    expect(
      renameRetiredRunJson(AgentRunSchema, { status: { subAgentExecutions: "not a list" } }),
    ).toEqual({ status: { subAgentRuns: "not a list" } });
    expect(renameRetiredRunJson(AgentRunSchema, { metadata: { labels: ["not", "a", "map"] } })).toEqual({
      metadata: { labels: ["not", "a", "map"] },
    });
  });

  it("keeps an enum value given by number, and a retired name that is not this enum's", () => {
    expect(decodeLoadedExecution({ status: { phase: 3 } }).status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(renameRetiredRunJson(AgentRunSchema, { status: { phase: "agent_execution" } })).toEqual({
      status: { phase: "agent_execution" },
    });
  });

  it("rewrites a kind string only where the contract declares one: a run's own kind, not an enum named kind", () => {
    expect(
      renameRetiredRunJson(AgentRunSchema, {
        kind: "AgentExecution",
        status: { artifacts: [{ kind: "AgentExecution" }] },
      }),
    ).toEqual({ kind: "AgentRun", status: { artifacts: [{ kind: "AgentExecution" }] } });
  });

  it("refuses a field set under its retired and its current name, whichever comes first", () => {
    for (const spec of [
      { supersedesExecutionId: "aex_a", supersedesRunId: "aex_b" },
      { supersedesRunId: "aex_b", supersedesExecutionId: "aex_a" },
    ]) {
      expect(() => renameRetiredRunJson(AgentRunSchema, { spec })).toThrow(
        /ai\.stigmer\.agentic\.agentrun\.v1\.AgentRunSpec sets the field supersedesRunId twice/,
      );
    }
  });

  it("drops a field the contract no longer knows", () => {
    const execution = decodeLoadedExecution({ metadata: { id: "aex_2" }, removedField: true });
    expect(execution.metadata?.id).toBe("aex_2");
  });
});

describe("getPhaseFromResult", () => {
  it("reads the phase a runner result recorded before the run rename", () => {
    // The ExecuteAgent result hitl-approval.json records.
    expect(getPhaseFromResult({ phase: "EXECUTION_WAITING_FOR_APPROVAL" })).toBe(
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    );
    expect(getPhaseFromResult({ phase: "RUN_COMPLETED" })).toBe(RunPhase.RUN_COMPLETED);
    expect(getPhaseFromResult({ phase: "EXECUTION_EXPLODED" })).toBe(
      RunPhase.RUN_PHASE_UNSPECIFIED,
    );
  });

  it("reads a numeric phase as is, and an absent or unreadable one as UNSPECIFIED", () => {
    expect(getPhaseFromResult({ phase: RunPhase.RUN_FAILED })).toBe(RunPhase.RUN_FAILED);
    expect(getPhaseFromResult(null)).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
    expect(getPhaseFromResult(undefined)).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
    expect(getPhaseFromResult({ phase: true })).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
  });
});

/** A name before the rename: its `run` words said `execution`. */
function retiredSpelling(name: string): string {
  return name
    .replace(/(^|_)runs($|_)/g, "$1executions$2")
    .replace(/(^|_)run($|_)/g, "$1execution$2")
    .replace(/(^|_)RUN(_|$)/g, "$1EXECUTION$2");
}

/** lowerCamelCase of a proto field name, as its JSON name spells it. */
function jsonSpelling(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

describe("the retired-names tables", () => {
  // `run_config` carried that name before the rename.
  const NAMED_RUN_BEFORE = new Set(["run_config"]);

  function crossingNames(): { fields: Map<string, string>; values: Map<string, string> } {
    const fields = new Map<string, string>();
    const values = new Map<string, string>();
    const seen = new Set<string>();
    const visit = (desc: DescMessage): void => {
      if (seen.has(desc.typeName) || desc.typeName.startsWith("google.protobuf.")) return;
      seen.add(desc.typeName);
      for (const field of desc.fields) {
        if (/(^|_)runs?($|_)/.test(field.name) && !NAMED_RUN_BEFORE.has(field.name)) {
          const retired = retiredSpelling(field.name);
          fields.set(retired, field.name);
          fields.set(jsonSpelling(retired), field.jsonName);
        }
        for (const value of field.enum?.values ?? []) {
          if (/(^|_)(RUN|runs?)(_|$)/.test(value.name)) {
            values.set(retiredSpelling(value.name), value.name);
          }
        }
        if (field.message !== undefined) visit(field.message);
      }
    };
    [AgentRunSchema, AgentRunStatusSchema, WorkflowRunStatusSchema].forEach(visit);
    return { fields, values };
  }

  it("map every run-named field and enum value that crosses Temporal from its name before the rename, and nothing else", () => {
    const { fields, values } = crossingNames();
    expect(new Map([...RETIRED_FIELD_NAMES].sort())).toEqual(new Map([...fields].sort()));
    expect(new Map([...RETIRED_ENUM_VALUE_NAMES].sort())).toEqual(new Map([...values].sort()));
  });
});
