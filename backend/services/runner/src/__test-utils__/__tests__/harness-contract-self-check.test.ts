/**
 * The harness contract kit's self-check: proof that every invariant in
 * `harness-contract/contract.ts` can FAIL.
 *
 * A contract kit that only ever passes proves nothing about the adapters it
 * runs against — it might be asserting the wrong thing, or nothing. So each
 * invariant is run here against an adapter deliberately broken in exactly the
 * way that invariant exists to catch, and the kit must reject with a message
 * that names the subject and the violation. The tester role's rule: a test
 * that cannot fail is not a test.
 *
 * Every broken adapter wraps the honest scripted fake and breaks ONE thing,
 * so a rejection here is attributable to the kit's assertion and not to some
 * other defect of the double. Where an invariant races a hang against the
 * interrupt bound, the bound is shortened through the assertion's parameter;
 * the production bound stays what `contract.ts` declares. Every subject is
 * booted first, as the kit's `describeHarnessContract` boots the adapters it
 * runs (the assertion functions require it).
 *
 * The second half checks the kit's own driver — the runtime stand-in — for
 * the facts a real adapter depends on and the fake never notices: the record
 * carries the persisted status (an adapter may read its grants from
 * `execution.status`, as the runtime guarantees), the engine's view carries
 * the driver's ids and decisions, and a stop lands only once the engine
 * reports it is parked.
 */

import { describe, it, expect } from "vitest";
import { CancelledFailure } from "@temporalio/activity";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import {
  ExecutionDriver,
  assertConcurrentTurnsAreIndependent,
  assertDecisionsExecuteExactlyOnce,
  assertEveryExitIsAnOutcome,
  assertLifetimesResolve,
  assertProposalIsWaitingAndUnexecuted,
  assertStateIdCapabilityAgrees,
  assertStopSignalInterrupts,
  assertUsageReachesSinkAsDeltas,
} from "../harness-contract/contract.js";
import { scriptedSubject } from "../harness-contract/scripted-adapter.js";
import type { ScriptedSubject } from "../harness-contract/scripted-adapter.js";
import { scenario } from "../harness-contract/types.js";
import type { EngineView, HarnessContractSubject, TurnScenario } from "../harness-contract/types.js";
import { findToolCallRow } from "../proto-helpers.js";

/** Short enough to keep this file fast; long enough that an honest microtask settle never trips it. */
const SHORT_BOUND_MS = 100;

// ── Wrapping helpers ────────────────────────────────────────────────────────

/** The kit boots before it asserts; so does every arm here. */
async function booted<S extends HarnessContractSubject>(subject: S): Promise<S> {
  await subject.adapter.boot(subject.config);
  return subject;
}

/** The honest fake's adapter with the named members replaced. */
function adapterOver(inner: HarnessAdapter, name: string, patch: Partial<HarnessAdapter>): HarnessAdapter {
  return {
    name,
    capabilities: inner.capabilities,
    boot: (config) => inner.boot(config),
    shutdown: () => inner.shutdown(),
    releaseSession: (sessionId) => inner.releaseSession(sessionId),
    runTurn: (input, sink) => inner.runTurn(input, sink),
    ...patch,
  };
}

/** A sink that delegates to the real one except for the named members. */
function sinkOver(inner: TurnSink, patch: Partial<TurnSink>): TurnSink {
  return {
    status: inner.status,
    stopSignal: inner.stopSignal,
    setupTiming: inner.setupTiming,
    requestPersist: () => inner.requestPersist(),
    recordActivity: (detail) => inner.recordActivity(detail),
    reportUsage: (delta) => inner.reportUsage(delta),
    reportProgress: (label) => inner.reportProgress(label),
    bindHarnessState: (id) => inner.bindHarnessState(id),
    ...patch,
  };
}

/** A subject over a broken adapter that still arranges and observes through the honest fake. */
function subjectOver(inner: ScriptedSubject, adapter: HarnessAdapter): HarnessContractSubject {
  return {
    name: adapter.name,
    harness: inner.harness,
    adapter,
    config: inner.config,
    arrange: (turn, view) => inner.arrange(turn, view),
    whenHanging: () => inner.whenHanging(),
    executionCount: (toolCallId) => inner.executionCount(toolCallId),
  };
}

function honest(): ScriptedSubject {
  return scriptedSubject({ pausePrimitive: "interrupt", stateIdSource: "engine-minted" });
}

// ── The broken adapters, one violation each ─────────────────────────────────

/** Throws the one thing an adapter must never throw. */
function throwsCancelledFailure(): HarnessContractSubject {
  const inner = honest();
  return subjectOver(inner, adapterOver(inner.adapter, "broken:throws-CancelledFailure", {
    runTurn: async () => {
      throw new CancelledFailure("adapter decided this was a pause");
    },
  }));
}

/** Treats every proposal as approved: executes what was never decided. */
function executesUndecidedProposals(): HarnessContractSubject {
  const inner = honest();
  let proposedIds: string[] = [];
  const adapter = adapterOver(inner.adapter, "broken:executes-undecided", {
    runTurn: (input, sink) => {
      const approvalDecisions = new Map(input.approvalDecisions);
      for (const id of proposedIds) if (!approvalDecisions.has(id)) approvalDecisions.set(id, ApprovalAction.APPROVE);
      return inner.adapter.runTurn({ ...input, approvalDecisions }, sink);
    },
  });
  return {
    ...subjectOver(inner, adapter),
    arrange: (turn: TurnScenario, view: EngineView) => {
      proposedIds = turn.flatMap((step) => (step.kind === "propose" ? [step.toolCallId] : []));
      inner.arrange(turn, view);
    },
  };
}

/** Re-gates a row an earlier invocation already settled — the second-ledger drift. */
function reGatesSettledRows(): HarnessContractSubject {
  const inner = honest();
  return subjectOver(inner, adapterOver(inner.adapter, "broken:re-gates-settled", {
    runTurn: (input, sink) => {
      for (const message of sink.status.messages) {
        for (const row of message.toolCalls) {
          if (row.status === ToolCallStatus.TOOL_CALL_COMPLETED) row.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
        }
      }
      return inner.adapter.runTurn(input, sink);
    },
  }));
}

/** Hands the engine a signal nobody will ever abort. */
function ignoresStopSignal(): HarnessContractSubject {
  const inner = honest();
  return subjectOver(inner, adapterOver(inner.adapter, "broken:ignores-stopSignal", {
    runTurn: (input, sink) => inner.adapter.runTurn(input, sinkOver(sink, { stopSignal: new AbortController().signal })),
  }));
}

/** Reports running totals where the contract asks for deltas. */
function reportsCumulativeUsage(): HarnessContractSubject {
  const inner = honest();
  return subjectOver(inner, adapterOver(inner.adapter, "broken:cumulative-usage", {
    runTurn: (input, sink) => {
      const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      return inner.adapter.runTurn(input, sinkOver(sink, {
        reportUsage: (delta) => {
          total.inputTokens += delta.inputTokens ?? 0;
          total.outputTokens += delta.outputTokens ?? 0;
          total.cacheReadTokens += delta.cacheReadTokens ?? 0;
          total.cacheWriteTokens += delta.cacheWriteTokens ?? 0;
          sink.reportUsage({ ...total });
        },
      }));
    },
  }));
}

/** Declares an engine-minted id and never binds one. */
function claimsEngineMintedNeverBinds(): HarnessContractSubject {
  const inner = scriptedSubject({ pausePrimitive: "interrupt", stateIdSource: "deterministic" });
  return subjectOver(inner, adapterOver(inner.adapter, "broken:claims-engine-minted", {
    capabilities: { ...inner.adapter.capabilities, stateIdSource: "engine-minted" },
  }));
}

/** Refuses to release a session it does not know. */
function refusesUnknownRelease(): HarnessContractSubject {
  const inner = honest();
  const served = new Set<string>();
  return subjectOver(inner, adapterOver(inner.adapter, "broken:refuses-unknown-release", {
    runTurn: (input, sink) => {
      served.add(input.sessionId);
      return inner.adapter.runTurn(input, sink);
    },
    releaseSession: async (sessionId) => {
      if (!served.has(sessionId)) throw new Error(`unknown session ${sessionId}`);
      await inner.adapter.releaseSession(sessionId);
    },
  }));
}

/** Runs turns one at a time through a single slot: per-turn state on the adapter object. */
function serializesTurns(): HarnessContractSubject {
  const inner = honest();
  let slot: Promise<unknown> = Promise.resolve();
  return subjectOver(inner, adapterOver(inner.adapter, "broken:serializes-turns", {
    runTurn: (input: TurnInput, sink: TurnSink): Promise<TurnOutcome> => {
      const next = slot.then(() => inner.adapter.runTurn(input, sink));
      slot = next.catch(() => undefined);
      return next;
    },
  }));
}

// ── The proof ───────────────────────────────────────────────────────────────

describe("harness contract kit self-check — every invariant can fail", () => {
  it("invariant 1 fires when runTurn throws a CancelledFailure", async () => {
    await expect(assertEveryExitIsAnOutcome(await booted(throwsCancelledFailure()), SHORT_BOUND_MS)).rejects.toThrow(/broken:throws-CancelledFailure: runTurn rejected with a CancelledFailure/);
  });

  it("invariant 2 fires when an undecided proposal executes", async () => {
    await expect(assertProposalIsWaitingAndUnexecuted(await booted(executesUndecidedProposals()))).rejects.toThrow(/broken:executes-undecided: .*awaiting_approval/);
  });

  it("invariant 3 fires when a settled row is re-gated on a later invocation", async () => {
    await expect(assertDecisionsExecuteExactlyOnce(await booted(reGatesSettledRows()))).rejects.toThrow(/broken:re-gates-settled: .*must not re-gate/);
  });

  it("invariant 4 fires when the adapter ignores stopSignal", async () => {
    await expect(assertStopSignalInterrupts(await booted(ignoresStopSignal()), SHORT_BOUND_MS)).rejects.toThrow(/broken:ignores-stopSignal: runTurn did not settle within 100ms/);
  });

  it("invariant 5 fires when usage is reported as running totals", async () => {
    await expect(assertUsageReachesSinkAsDeltas(await booted(reportsCumulativeUsage()))).rejects.toThrow(/broken:cumulative-usage: .*must sum to what the engine emitted/);
  });

  it("invariant 6 fires when an adapter claims engine-minted and never binds", async () => {
    await expect(assertStateIdCapabilityAgrees(await booted(claimsEngineMintedNeverBinds()))).rejects.toThrow(/broken:claims-engine-minted: .*must bind its state id/);
  });

  it("invariant 7 fires when releaseSession rejects an unknown session", async () => {
    await expect(assertLifetimesResolve(await booted(refusesUnknownRelease()))).rejects.toThrow(/broken:refuses-unknown-release: releaseSession for an unknown session rejected/);
  });

  it("invariant 8 fires when the adapter serializes turns through shared state", async () => {
    await expect(assertConcurrentTurnsAreIndependent(await booted(serializesTurns()), SHORT_BOUND_MS)).rejects.toThrow(/broken:serializes-turns: runTurn did not settle within 100ms/);
  });
});

// ── The driver: the runtime stand-in's own guarantees ───────────────────────

const WRITE_BETA = { kind: "write", resource: "/work/beta.txt" } as const;

describe("harness contract kit self-check — the driver stands in for the runtime faithfully", () => {
  it("hands the adapter the persisted status on the record AND the sink, as two clones", async () => {
    const subject = await booted(honest());
    const driver = new ExecutionDriver(subject, "driver-record");
    const id = "driver-record-write";

    const first = await driver.turn([scenario.propose(id, WRITE_BETA)]);
    expect(first.outcome.kind).toBe("awaiting_approval");
    expect(first.input.execution.status?.messages ?? [], "a first turn's record carries no persisted status").toHaveLength(0);
    driver.decide(id, ApprovalAction.APPROVE);

    const second = driver.begin([scenario.propose(id, WRITE_BETA)]);
    const onRecord = second.input.execution.status;
    expect(onRecord, "the reinvocation's record must carry what the previous turn persisted").toBeDefined();
    expect(findToolCallRow(onRecord!, id)?.approvalAction, "the decision is on the record's row").toBe(ApprovalAction.APPROVE);
    expect(findToolCallRow(second.sink.status, id)?.approvalAction, "and on the sink's row").toBe(ApprovalAction.APPROVE);
    expect(onRecord, "the record's copy and the sink's copy are distinct objects, as after a real persist and read-back").not.toBe(second.sink.status);
    expect(second.input.approvalDecisions.get(id), "the decisions map is the runtime's reader over the same rows").toBe(ApprovalAction.APPROVE);
    await second.settled;
  });

  it("arranges the engine with the driver's ids and the decisions the prompt will carry", async () => {
    const inner = await booted(honest());
    const views: EngineView[] = [];
    const subject: HarnessContractSubject = {
      ...inner,
      arrange: (turn, view) => {
        views.push(view);
        inner.arrange(turn, view);
      },
    };
    const driver = new ExecutionDriver(subject, "driver-view");
    const id = "driver-view-write";

    await driver.turn([scenario.propose(id, WRITE_BETA)]);
    driver.decide(id, ApprovalAction.SKIP);
    await driver.turn([scenario.propose(id, WRITE_BETA), scenario.say("on")]);

    expect(views.map((v) => v.executionId)).toEqual([driver.executionId, driver.executionId]);
    expect(views.map((v) => v.sessionId)).toEqual([driver.sessionId, driver.sessionId]);
    expect(views[0]!.approvalDecisions.size, "nothing decided before the first turn").toBe(0);
    expect(views[1]!.approvalDecisions.get(id), "the reinvocation's view carries the decision").toBe(ApprovalAction.SKIP);
  });

  it("stops a turn only once the engine reports it is parked, never during setup", async () => {
    const inner = await booted(honest());
    let sinkInFlight: TurnSink | undefined;
    let abortedWhenParked: boolean | undefined;
    // Observes the signal at the instant the engine reports the hang; the
    // driver's own abort is chained after this observer.
    const subject: HarnessContractSubject = {
      ...inner,
      whenHanging: () =>
        inner.whenHanging().then(() => {
          abortedWhenParked = sinkInFlight?.stopSignal.aborted;
        }),
    };
    const driver = new ExecutionDriver(subject, "driver-stop");

    const turn = driver.begin([scenario.say("setting up"), scenario.hang(), scenario.say("never")], { stopWhenHanging: "kit: stop" });
    sinkInFlight = turn.sink;
    const outcome = await turn.settled;

    expect(outcome.kind).toBe("interrupted");
    expect(abortedWhenParked, "at the moment the engine reported the hang the signal was still live").toBe(false);
    expect(turn.sink.stopSignal.aborted, "and it was aborted after").toBe(true);
    expect(turn.sink.status.messages.map((m) => m.content), "the stop landed in the hang, after the setup step and before the step after it").toEqual(["setting up"]);
  });
});
