/**
 * Pins the bound-execution reader (bound-execution.ts) in isolation, with
 * the clock injected, so the liveness rule every lane shares is stated
 * by enumeration here and the verifier's and the decrypt lane's tests can
 * assert behavior rather than restate it:
 *
 *   - the kind is read off the id alone: the run by the contract's
 *     prefix table, the connect binding by its own predicate;
 *     anything else is `undefined` with no store read;
 *   - a connect binding resolves through the connect's ExecutionContext
 *     row (by `spec.executionId`), is live while that row exists, and is
 *     not a run (`bindsARun`) — the shape both no-`exp` lanes refuse; two
 *     rows naming one connect bind nothing (no first-match guess);
 *   - live is "not terminal" for the run's OWN terminal set (its
 *     TERMINATED and WAITING_FOR_APPROVAL are the arms that differ from a
 *     naive set);
 *   - a terminal row is live within the grace of its `completed_at`, dead
 *     at the boundary and beyond, and dead at once with no timestamp or an
 *     unparsable one (fail closed);
 *   - a missing row is `undefined`; any other store failure propagates as
 *     the same error object.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase as AgentPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { newConnectExecutionId } from "../../domain/mcpserver/connect-execution-id.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import {
  bindsARun,
  boundExecutionKindOf,
  loadBoundExecution,
} from "../bound-execution.js";
import type { BoundExecutionStore } from "../bound-execution.js";
import { RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS } from "../constants.js";

const NOW = Date.parse("2026-09-16T12:00:00Z");
const iso = (offsetMs: number): string =>
  new Date(NOW + offsetMs).toISOString();

/**
 * A store of rows by id, plus the connect ECs by the execution id they
 * were created for (`findAllByField` on `spec.executionId`, as stored
 * bytes; one id may carry several rows). `reads` records every lookup key,
 * so an arm can assert "no store read" and which read.
 */
function storeOf(
  rows: Record<string, unknown>,
  executionContexts: Record<string, ExecutionContext | ExecutionContext[]> = {},
): BoundExecutionStore & {
  reads: string[];
} {
  const contextsFor = (value: string): ExecutionContext[] => {
    const entry = executionContexts[value];
    return entry === undefined ? [] : Array.isArray(entry) ? entry : [entry];
  };
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
    findAllByField<Desc extends DescMessage>(
      kind: ApiResourceKind,
      fieldPath: string,
      value: string,
      _schema: Desc,
    ): Promise<Uint8Array[]> {
      reads.push(`${fieldPath}=${value}`);
      return Promise.resolve(
        kind === ApiResourceKind.execution_context &&
          fieldPath === "spec.executionId"
          ? contextsFor(value).map((row) =>
              toBinary(ExecutionContextSchema, row),
            )
          : [],
      );
    },
  };
}

function connectContext(executionId: string, createdBy: string, org = "acme") {
  return create(ExecutionContextSchema, {
    metadata: { id: "ectx_1", name: `exec-ctx-${executionId}`, org },
    spec: { executionId },
    status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
}

function runRow(
  id: string,
  phase: AgentPhase,
  completedAt = "",
  extra: { createdBy?: string; sessionId?: string; org?: string } = {},
) {
  return create(RunSchema, {
    metadata: { id, name: id, org: extra.org ?? "acme" },
    spec: { target: { case: "sessionId", value: extra.sessionId ?? "" } },
    status: {
      phase,
      completedAt,
      audit: { specAudit: { createdBy: { id: extra.createdBy ?? "" } } },
    },
  });
}

describe("boundExecutionKindOf", () => {
  it.each([
    ["run_1", "agent-execution"],
    // A run minted before the run kind's prefix became `run` keeps its id,
    // so a pre-upgrade run waiting on an approval keeps its credential.
    ["aex_1", "agent-execution"],
    [newConnectExecutionId("mcps_1"), "mcp-connect"],
  ])("%s binds %s", (id, kind) => {
    expect(boundExecutionKindOf(id)).toBe(kind);
  });

  // `wex_1`: a retired workflow run's credential carries no expiry, so it
  // must bind nothing rather than fall back to a kind.
  it.each([["ses_1"], ["agt_1"], ["zzz_1"], [""], ["run"], ["aex"], ["connect"], ["wex_1"]])(
    "%s binds nothing",
    (id) => {
      expect(boundExecutionKindOf(id)).toBeUndefined();
    },
  );
});

describe("bindsARun — what a no-`exp` credential may name", () => {
  it.each([
    ["agent-execution", true],
    ["mcp-connect", false],
  ] as const)("%s → %s", (kind, expected) => {
    expect(bindsARun(kind)).toBe(expected);
  });
});

describe("loadBoundExecution", () => {
  it("reads the row's facts the lane needs and nothing else", async () => {
    const store = storeOf({
      aex_1: runRow("aex_1", AgentPhase.RUN_IN_PROGRESS, "", {
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

  it("an id that binds no kind is undefined with NO store read", async () => {
    const store = storeOf({});
    expect(await loadBoundExecution(store, "ses_1", NOW)).toBeUndefined();
    expect(store.reads).toEqual([]);
  });

  describe("the connect binding — the ExecutionContext row by its execution id", () => {
    const connectId = newConnectExecutionId("mcps_1");

    it("resolves to the row's creator and org, no session, live while the row exists", async () => {
      const store = storeOf(
        {},
        { [connectId]: connectContext(connectId, "ida_member", "acme") },
      );
      expect(await loadBoundExecution(store, connectId, NOW)).toEqual({
        kind: "mcp-connect",
        executionId: connectId,
        org: "acme",
        createdBy: "ida_member",
        sessionId: "",
        live: true,
      });
      // The read getByExecutionId already makes, and no primary-key read.
      expect(store.reads).toEqual([`spec.executionId=${connectId}`]);
    });

    it("a connect whose row is gone (the connect settled) is undefined — the credential names no row", async () => {
      expect(
        await loadBoundExecution(storeOf({}), connectId, NOW),
      ).toBeUndefined();
    });

    it("two contexts naming one connect bind nothing — the lookup refuses to guess, and the credential fails closed", async () => {
      const store = storeOf(
        {},
        {
          [connectId]: [
            connectContext(connectId, "ida_member", "acme"),
            connectContext(connectId, "ida_other", "acme"),
          ],
        },
      );
      expect(await loadBoundExecution(store, connectId, NOW)).toBeUndefined();
    });

    it("a store fault on the EC read propagates as the same error object", async () => {
      const fault = new Error("connection reset");
      const store: BoundExecutionStore = {
        getResource: vi.fn(() => Promise.reject(new Error("unreachable"))),
        findAllByField: vi.fn(() => Promise.reject(fault)),
      };
      await expect(loadBoundExecution(store, connectId, NOW)).rejects.toBe(
        fault,
      );
    });
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
      findAllByField: vi.fn(() => Promise.reject(new Error("unreachable"))),
    };
    await expect(loadBoundExecution(store, "aex_1", NOW)).rejects.toBe(fault);
  });

  describe("liveness — the agent execution's own terminal set", () => {
    it.each([
      ["PENDING", AgentPhase.RUN_PENDING],
      ["IN_PROGRESS", AgentPhase.RUN_IN_PROGRESS],
      ["WAITING_FOR_APPROVAL", AgentPhase.RUN_WAITING_FOR_APPROVAL],
      ["PAUSED", AgentPhase.RUN_PAUSED],
    ])("%s is live", async (_name, phase) => {
      const store = storeOf({ aex_1: runRow("aex_1", phase) });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(true);
    });

    it.each([
      ["COMPLETED", AgentPhase.RUN_COMPLETED],
      ["FAILED", AgentPhase.RUN_FAILED],
      ["CANCELLED", AgentPhase.RUN_CANCELLED],
      ["TERMINATED", AgentPhase.RUN_TERMINATED],
    ])(
      "%s with no completed_at is dead at once — no grace without a timestamp",
      async (_name, phase) => {
        const store = storeOf({ aex_1: runRow("aex_1", phase) });
        expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(
          false,
        );
      },
    );

    it("a row with no status has not started, which is live", async () => {
      const store = storeOf({
        aex_1: create(RunSchema, { metadata: { id: "aex_1" } }),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(true);
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
        aex_1: runRow("aex_1", AgentPhase.RUN_COMPLETED, iso(offset)),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(live);
    });

    it("a completed_at in the future (a skewed writer's clock) is inside the grace, not an error", async () => {
      const store = storeOf({
        aex_1: runRow("aex_1", AgentPhase.RUN_COMPLETED, iso(60_000)),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(true);
    });

    it("an unparsable completed_at gets no grace — fail closed", async () => {
      const store = storeOf({
        aex_1: runRow(
          "aex_1",
          AgentPhase.RUN_COMPLETED,
          "yesterday-ish",
        ),
      });
      expect((await loadBoundExecution(store, "aex_1", NOW))?.live).toBe(false);
    });
  });
});
