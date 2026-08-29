/**
 * Pins the ExecutionReadScope arm of BOTH getExecutionSummary handlers
 * (C2 Stage 4 — the multi-tenant tenant-isolation port):
 *
 *   - a composed scope narrows the aggregation to authorized ids ∩ the
 *     requested org (the Java GetExecutionSummary baseline);
 *   - an EMPTY authorized set answers the proto DEFAULT INSTANCE — the
 *     conformance-pinned multi-tenant zero shape (workflow: success_rate
 *     0 and NO cost summary — the exact opposite of the OSS -1 sentinel
 *     and always-present zero cost) falls out of the scoping;
 *   - NO scope composed = the full scan, org NOT consulted (the OSS
 *     single-user semantics, byte-identity guarded here as well as by
 *     the conformance rosters).
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase as AgentExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { GetAgentExecutionSummaryRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { GetExecutionSummaryRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { ExecutionReadScope } from "../../../extensions/execution-read-scope.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { Store } from "../../../store/interface.js";

import { getExecutionSummary as getAgentSummary } from "../../agentexecution/usage.js";
import { getExecutionSummary as getWorkflowSummary } from "../get-execution-summary.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const caller = testCallerIdentity();

function scopeOf(ids: ReadonlyArray<string>): ExecutionReadScope {
  return {
    authorizedExecutionIds: () => Promise.resolve(new Set(ids)),
  };
}

/** A store whose listResources answers the given serialized rows. */
function listOnlyStore(rows: Uint8Array[]): Store {
  return { listResources: () => Promise.resolve(rows) } as unknown as Store;
}

function workflowExecRow(id: string, org: string, phase: ExecutionPhase) {
  return toBinary(
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, {
      metadata: { id, name: id, slug: id, org },
      status: { phase },
    }),
  );
}

function agentExecRow(id: string, org: string, phase: AgentExecutionPhase) {
  return toBinary(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      metadata: { id, name: id, org },
      status: { phase },
    }),
  );
}

describe("workflow getExecutionSummary read scope", () => {
  const rows = [
    workflowExecRow("wfe_mine_done", "acme", ExecutionPhase.EXECUTION_COMPLETED),
    workflowExecRow("wfe_mine_run", "acme", ExecutionPhase.EXECUTION_IN_PROGRESS),
    // Authorized but in ANOTHER org — the org intersection must drop it.
    workflowExecRow("wfe_other_org", "rival", ExecutionPhase.EXECUTION_FAILED),
    // In the org but NOT authorized — the id set must drop it.
    workflowExecRow("wfe_not_mine", "acme", ExecutionPhase.EXECUTION_FAILED),
  ];

  function deps(scope: ExecutionReadScope | undefined) {
    return {
      store: listOnlyStore(rows),
      logger: silentLogger,
      executionReadScope: scope,
    };
  }

  it("narrows to authorized ids ∩ the requested org", async () => {
    const summary = await getWorkflowSummary(
      deps(scopeOf(["wfe_mine_done", "wfe_mine_run", "wfe_other_org"])),
      create(GetExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.totalCount).toBe(2);
    expect(summary.activeCount).toBe(1);
    // One terminal (completed) — a real 100%, not the -1 sentinel.
    expect(summary.successRate).toBe(1);
  });

  it("an empty authorized set answers the default instance — the multi-tenant zero shape", async () => {
    const summary = await getWorkflowSummary(
      deps(scopeOf([])),
      create(GetExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.successRate).toBe(0);
    expect(summary.totalCost).toBeUndefined();
    expect(summary.totalCount).toBe(0);
    expect(summary.avgDuration).toBeUndefined();
  });

  it("no scope composed = the full scan; org is NOT consulted (OSS byte-identity)", async () => {
    const summary = await getWorkflowSummary(
      deps(undefined),
      create(GetExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    // All four rows counted, the rival org's included; and the OSS zero
    // pins hold: the -1 sentinel family and the ALWAYS-present cost
    // summary.
    expect(summary.totalCount).toBe(4);
    expect(summary.totalCost).toBeDefined();
  });
});

describe("agent getExecutionSummary read scope", () => {
  const rows = [
    agentExecRow("aexec_mine", "acme", AgentExecutionPhase.EXECUTION_IN_PROGRESS),
    agentExecRow("aexec_other_org", "rival", AgentExecutionPhase.EXECUTION_IN_PROGRESS),
    agentExecRow("aexec_not_mine", "acme", AgentExecutionPhase.EXECUTION_IN_PROGRESS),
  ];

  function deps(scope: ExecutionReadScope | undefined) {
    return {
      store: listOnlyStore(rows),
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      executionReadScope: scope,
    };
  }

  it("narrows to authorized ids ∩ the requested org", async () => {
    const summary = await getAgentSummary(
      deps(scopeOf(["aexec_mine", "aexec_other_org"])),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.activeCount).toBe(1);
  });

  it("an empty authorized set answers the default instance", async () => {
    const summary = await getAgentSummary(
      deps(scopeOf([])),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.activeCount).toBe(0);
    expect(summary.phaseCounts).toEqual({});
    expect(summary.avgDuration).toBeUndefined();
  });

  it("no scope composed = the full scan across orgs (OSS byte-identity)", async () => {
    const summary = await getAgentSummary(
      deps(undefined),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.activeCount).toBe(3);
  });

  it("the scope receives the kind it is scoping (agent_execution here)", async () => {
    const kinds: ApiResourceKind[] = [];
    const recordingScope: ExecutionReadScope = {
      authorizedExecutionIds: (_caller, kind) => {
        kinds.push(kind);
        return Promise.resolve(new Set<string>());
      },
    };
    await getAgentSummary(
      deps(recordingScope),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(kinds).toEqual([ApiResourceKind.agent_execution]);
  });
});
