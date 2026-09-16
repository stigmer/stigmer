/**
 * Pins the bound-execution reader (bound-execution.ts) in isolation, with
 * the clock injected, so the liveness rule every lane shares is stated
 * by enumeration here and the verifier's and the decrypt lane's tests can
 * assert behavior rather than restate it:
 *
 *   - the kind is read off the id's prefix and only the two execution
 *     kinds bind; anything else is `undefined` with no store read;
 *   - live is "not terminal" for each kind's OWN terminal set (the agent
 *     side's TERMINATED and WAITING_FOR_APPROVAL, the workflow side's
 *     TERMINATED and PAUSED are the arms that differ from a naive set);
 *   - a terminal row is live within the grace of its `completed_at`, dead
 *     at the boundary and beyond, and dead at once with no timestamp or an
 *     unparsable one (fail closed);
 *   - a missing row is `undefined`; any other store failure propagates as
 *     the same error object.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase as AgentPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase as WorkflowPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import {
  boundExecutionKindOf,
  loadBoundExecution,
} from "../bound-execution.js";
import type { BoundExecutionStore } from "../bound-execution.js";
import { RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS } from "../constants.js";

const NOW = Date.parse("2026-09-16T12:00:00Z");
const iso = (offsetMs: number): string =>
  new Date(NOW + offsetMs).toISOString();

function storeOf(rows: Record<string, unknown>): BoundExecutionStore & {
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    getResource<Desc extends DescMessage>(
      kind: ApiResourceKind,
      id: string,
      _schema: Desc,
    ): Promise<MessageShape<Desc>> {
      reads.push(id);
      const row = rows[id];
      return row === undefined
        ? Promise.reject(new ResourceNotFoundError(`${kind}/${id}`))
        : Promise.resolve(row as MessageShape<Desc>);
    },
  };
}

function agentRun(
  id: string,
  phase: AgentPhase,
  completedAt = "",
  extra: { createdBy?: string; sessionId?: string; org?: string } = {},
) {
  return create(AgentExecutionSchema, {
    metadata: { id, name: id, org: extra.org ?? "acme" },
    spec: { sessionId: extra.sessionId ?? "" },
    status: {
      phase,
      completedAt,
      audit: { specAudit: { createdBy: { id: extra.createdBy ?? "" } } },
    },
  });
}

function workflowRun(id: string, phase: WorkflowPhase, completedAt = "") {
  return create(WorkflowExecutionSchema, {
    metadata: { id, name: id, org: "acme" },
    status: { phase, completedAt },
  });
}

describe("boundExecutionKindOf", () => {
  it.each([
    ["aex_1", "agent-execution"],
    ["wex_1", "workflow-execution"],
  ])("%s binds %s", (id, kind) => {
    expect(boundExecutionKindOf(id)).toBe(kind);
  });

  it.each([["ses_1"], ["agt_1"], ["zzz_1"], [""], ["aex"]])(
    "%s binds nothing",
    (id) => {
      expect(boundExecutionKindOf(id)).toBeUndefined();
    },
  );
});

describe("loadBoundExecution", () => {
  it("reads the row's facts the lane needs and nothing else", async () => {
    const store = storeOf({
      aex_1: agentRun("aex_1", AgentPhase.EXECUTION_IN_PROGRESS, "", {
        createdBy: "ida_carol",
        sessionId: "ses_carol",
        org: "acme",
      }),
    });
    expect(await loadBoundExecution(store, "aex_1", NOW)).toEqual({
      kind: "agent-execution",
      executionId: "aex_1",
      org: "acme",
      createdBy: "ida_carol",
      sessionId: "ses_carol",
      live: true,
    });
  });

  it("an id that binds no execution kind is undefined with NO store read", async () => {
    const store = storeOf({});
    expect(await loadBoundExecution(store, "ses_1", NOW)).toBeUndefined();
    expect(store.reads).toEqual([]);
  });

  it("a missing row is undefined — the typed not-found, and only that, is absorbed", async () => {
    expect(
      await loadBoundExecution(storeOf({}), "aex_missing", NOW),
    ).toBeUndefined();
  });

  it("any other store failure propagates as the same error object", async () => {
    const fault = new Error("connection reset");
    const store: BoundExecutionStore = {
      getResource: vi.fn(() => Promise.reject(fault)),
    };
    await expect(loadBoundExecution(store, "aex_1", NOW)).rejects.toBe(fault);
  });

  describe("liveness — the agent execution's own terminal set", () => {
    it.each([
      ["PENDING", AgentPhase.EXECUTION_PENDING],
      ["IN_PROGRESS", AgentPhase.EXECUTION_IN_PROGRESS],
      ["WAITING_FOR_APPROVAL", AgentPhase.EXECUTION_WAITING_FOR_APPROVAL],
      ["PAUSED", AgentPhase.EXECUTION_PAUSED],
    ])("%s is live", async (_name, phase) => {
      const store = storeOf({ aex_1: agentRun("aex_1", phase) });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(true);
    });

    it.each([
      ["COMPLETED", AgentPhase.EXECUTION_COMPLETED],
      ["FAILED", AgentPhase.EXECUTION_FAILED],
      ["CANCELLED", AgentPhase.EXECUTION_CANCELLED],
      ["TERMINATED", AgentPhase.EXECUTION_TERMINATED],
    ])(
      "%s with no completed_at is dead at once — no grace without a timestamp",
      async (_name, phase) => {
        const store = storeOf({ aex_1: agentRun("aex_1", phase) });
        expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(
          false,
        );
      },
    );

    it("a row with no status has not started, which is live", async () => {
      const store = storeOf({
        aex_1: create(AgentExecutionSchema, { metadata: { id: "aex_1" } }),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(true);
    });
  });

  describe("liveness — the workflow execution's own terminal set", () => {
    it.each([
      ["PENDING", WorkflowPhase.EXECUTION_PENDING],
      ["IN_PROGRESS", WorkflowPhase.EXECUTION_IN_PROGRESS],
      ["PAUSED", WorkflowPhase.EXECUTION_PAUSED],
    ])("%s is live", async (_name, phase) => {
      const store = storeOf({ wex_1: workflowRun("wex_1", phase) });
      expect((await loadBoundExecution(store, "wex_1", NOW))?.live).toBe(true);
    });

    it.each([
      ["COMPLETED", WorkflowPhase.EXECUTION_COMPLETED],
      ["FAILED", WorkflowPhase.EXECUTION_FAILED],
      ["CANCELLED", WorkflowPhase.EXECUTION_CANCELLED],
      ["TERMINATED", WorkflowPhase.EXECUTION_TERMINATED],
    ])("%s with no completed_at is dead at once", async (_name, phase) => {
      const store = storeOf({ wex_1: workflowRun("wex_1", phase) });
      expect((await loadBoundExecution(store, "wex_1", NOW))?.live).toBe(false);
    });

    it("a workflow execution has no session — the field is empty, never a guess", async () => {
      const store = storeOf({
        wex_1: workflowRun("wex_1", WorkflowPhase.EXECUTION_IN_PROGRESS),
      });
      expect((await loadBoundExecution(store, "wex_1", NOW))?.sessionId).toBe(
        "",
      );
    });
  });

  describe("the grace after terminal, measured from completed_at", () => {
    const G = RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS;

    it.each([
      ["the moment it ended", 0, true],
      ["one millisecond before the grace ends", -(G - 1), true],
      ["exactly at the grace boundary", -G, false],
      ["long after", -(G * 10), false],
    ])("a run that ended %s → live=%s", async (_label, offset, live) => {
      const store = storeOf({
        aex_1: agentRun("aex_1", AgentPhase.EXECUTION_COMPLETED, iso(offset)),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(live);
    });

    it("a completed_at in the future (a skewed writer's clock) is inside the grace, not an error", async () => {
      const store = storeOf({
        aex_1: agentRun("aex_1", AgentPhase.EXECUTION_COMPLETED, iso(60_000)),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(true);
    });

    it("an unparsable completed_at gets no grace — fail closed", async () => {
      const store = storeOf({
        aex_1: agentRun(
          "aex_1",
          AgentPhase.EXECUTION_COMPLETED,
          "yesterday-ish",
        ),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(false);
    });

    it("the same rule applies to a workflow execution", async () => {
      const store = storeOf({
        wex_1: workflowRun("wex_1", WorkflowPhase.EXECUTION_FAILED, iso(-1000)),
        wex_2: workflowRun("wex_2", WorkflowPhase.EXECUTION_FAILED, iso(-G)),
      });
      expect((await loadBoundExecution(store, "wex_1", NOW))?.live).toBe(true);
      expect((await loadBoundExecution(store, "wex_2", NOW))?.live).toBe(false);
    });
  });
});
