/**
 * Pins the read of BOTH getExecutionSummary handlers through the list
 * index and the ListReadScope's restrict verb:
 *
 *   - the rows are the requested org's, within the time window, read
 *     through the index in every posture (a row with no creation stamp is
 *     kept, as the aggregation loop keeps it);
 *   - a composed scope is offered exactly those rows and never asked to
 *     enumerate (its enumeration verb throws here); the aggregation runs
 *     over the rows it keeps;
 *   - when it keeps NONE the answer is the proto DEFAULT INSTANCE — the
 *     conformance-pinned multi-tenant zero shape (workflow: success_rate 0
 *     and NO cost summary, the opposite of the OSS -1 sentinel and
 *     always-present zero cost);
 *   - NO scope composed = every row of the org and window, and the OSS
 *     zero pins hold.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase as AgentExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { GetAgentExecutionSummaryRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  GetExecutionSummaryRequestSchema,
  SummaryTimeWindow,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { ListReadScope } from "../../../extensions/list-read-scope.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";

import { getExecutionSummary as getAgentSummary } from "../../agentexecution/usage.js";
import { getExecutionSummary as getWorkflowSummary } from "../get-execution-summary.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const caller = testCallerIdentity();
const NOW_SECONDS = BigInt(Math.floor(Date.now() / 1000));
const DAY = 24n * 60n * 60n;

interface RecordingScope extends ListReadScope {
  readonly offered: Array<{ kind: ApiResourceKind; ids: string[] }>;
}

/** A scope that keeps `allowed`, records what it was offered, and refuses to enumerate. */
function restrictingScope(allowed: ReadonlyArray<string>): RecordingScope {
  const offered: Array<{ kind: ApiResourceKind; ids: string[] }> = [];
  return {
    offered,
    authorizedResourceIds: () =>
      Promise.reject(new Error("the summaries never enumerate")),
    restrictListEntries: (_caller, kind, entries) => {
      offered.push({ kind, ids: entries.map((e) => e.id).sort() });
      return Promise.resolve(
        new Set(entries.map((e) => e.id).filter((id) => allowed.includes(id))),
      );
    },
  };
}

let temp: TempStore | undefined;
afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

function audit(createdDaysAgo: bigint | undefined) {
  return createdDaysAgo === undefined
    ? {}
    : {
        audit: {
          specAudit: {
            createdAt: {
              seconds: NOW_SECONDS - createdDaysAgo * DAY,
              nanos: 0,
            },
          },
        },
      };
}

async function workflowStore(): Promise<Store> {
  temp = tempStore();
  const rows: Array<[string, string, ExecutionPhase, bigint | undefined]> = [
    ["wfe_mine_done", "acme", ExecutionPhase.EXECUTION_COMPLETED, 1n],
    ["wfe_mine_run", "acme", ExecutionPhase.EXECUTION_IN_PROGRESS, undefined],
    ["wfe_not_mine", "acme", ExecutionPhase.EXECUTION_FAILED, 1n],
    ["wfe_stale", "acme", ExecutionPhase.EXECUTION_FAILED, 30n],
    ["wfe_other_org", "rival", ExecutionPhase.EXECUTION_FAILED, 1n],
  ];
  for (const [id, org, phase, days] of rows) {
    await temp.store.saveResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, {
        metadata: { id, name: id, slug: id, org },
        status: { phase, ...audit(days) },
      }),
    );
  }
  return temp.store;
}

async function agentStore(): Promise<Store> {
  temp = tempStore();
  const rows: Array<[string, string]> = [
    ["aexec_mine", "acme"],
    ["aexec_not_mine", "acme"],
    ["aexec_other_org", "rival"],
  ];
  for (const [id, org] of rows) {
    await temp.store.saveResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        metadata: { id, name: id, org },
        status: {
          phase: AgentExecutionPhase.EXECUTION_IN_PROGRESS,
          ...audit(1n),
        },
      }),
    );
  }
  return temp.store;
}

const LAST_7D = { org: "acme", timeWindow: SummaryTimeWindow.LAST_7D };

describe("workflow getExecutionSummary read", () => {
  it("offers the scope the org's rows within the window, and aggregates the ones it keeps", async () => {
    const scope = restrictingScope([
      "wfe_mine_done",
      "wfe_mine_run",
      "wfe_other_org",
    ]);
    const summary = await getWorkflowSummary(
      {
        store: await workflowStore(),
        logger: silentLogger,
        listReadScope: scope,
      },
      create(GetExecutionSummaryRequestSchema, LAST_7D),
      caller,
    );
    expect(scope.offered).toEqual([
      {
        kind: ApiResourceKind.workflow_execution,
        ids: ["wfe_mine_done", "wfe_mine_run", "wfe_not_mine"],
      },
    ]);
    expect(summary.totalCount).toBe(2);
    expect(summary.activeCount).toBe(1);
    // One terminal (completed) — a real 100%, not the -1 sentinel.
    expect(summary.successRate).toBe(1);
  });

  it("answers the default instance when the scope keeps none — the multi-tenant zero shape", async () => {
    const summary = await getWorkflowSummary(
      {
        store: await workflowStore(),
        logger: silentLogger,
        listReadScope: restrictingScope([]),
      },
      create(GetExecutionSummaryRequestSchema, LAST_7D),
      caller,
    );
    expect(summary.successRate).toBe(0);
    expect(summary.totalCost).toBeUndefined();
    expect(summary.totalCount).toBe(0);
    expect(summary.avgDuration).toBeUndefined();
  });

  it("with no scope composed counts every row of the org and window, and keeps the OSS zero pins", async () => {
    const summary = await getWorkflowSummary(
      {
        store: await workflowStore(),
        logger: silentLogger,
        listReadScope: undefined,
      },
      create(GetExecutionSummaryRequestSchema, LAST_7D),
      caller,
    );
    // The org's three rows in the window, the unstamped one included; the
    // stale row and the rival org's row are not read.
    expect(summary.totalCount).toBe(3);
    expect(summary.totalCost).toBeDefined();
  });
});

describe("agent getExecutionSummary read", () => {
  function deps(store: Store, scope: ListReadScope | undefined) {
    return {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      listReadScope: scope,
    };
  }

  it("offers the scope the org's rows as agent executions, and aggregates the ones it keeps", async () => {
    const scope = restrictingScope(["aexec_mine", "aexec_other_org"]);
    const summary = await getAgentSummary(
      deps(await agentStore(), scope),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(scope.offered).toEqual([
      {
        kind: ApiResourceKind.agent_execution,
        ids: ["aexec_mine", "aexec_not_mine"],
      },
    ]);
    expect(summary.activeCount).toBe(1);
  });

  it("answers the default instance when the scope keeps none", async () => {
    const summary = await getAgentSummary(
      deps(await agentStore(), restrictingScope([])),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.activeCount).toBe(0);
    expect(summary.phaseCounts).toEqual({});
    expect(summary.avgDuration).toBeUndefined();
  });

  it("with no scope composed counts every row of the org", async () => {
    const summary = await getAgentSummary(
      deps(await agentStore(), undefined),
      create(GetAgentExecutionSummaryRequestSchema, { org: "acme" }),
      caller,
    );
    expect(summary.activeCount).toBe(2);
  });
});
