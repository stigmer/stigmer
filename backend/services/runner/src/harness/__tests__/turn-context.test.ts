/**
 * Pins the turn context's pure decisions — the places `turn-context.ts`
 * decides something rather than fetching it:
 *
 *  - `isReinvocation`: the runtime's one reading of "does this invocation
 *    resume rather than begin", keyed on how the harness mints its state id.
 *    The engine-minted arm is `!!threadId`; the deterministic arm is
 *    whether the log holds an event the run's engine wrote
 *    (`runWroteEngineEvents`, one bounded read of the types only an
 *    engine's rows produce), whatever the thread id says (the id exists on
 *    the first turn too), and never the live engine checkpoint.
 *  - `fileReviewOn`: a turn's file review is on when the session asks for
 *    it or the run is a plugin-eval try, and off otherwise (the default).
 *  - `reconcileTurnSettlement`: a reconcile turn completes, its rows naming
 *    the files put back, or the failures when any undo failed.
 *  - `regeneratesApprovedWrites`: which pause primitives make the runner pin
 *    an approved whole-file write's bytes itself (the engine re-runs the
 *    model) and which never do (the engine applies the exact args it paused
 *    on).
 *  - `reconcileReinvocation`: a resumed invocation's seed and answers come
 *    from one read of the run's log (`transcript/resume-seed.ts`,
 *    `approval-answers.ts`); when that read fails, the turn's start fails,
 *    never a turn that runs with no asks and no answers.
 *
 * The phases that fetch and provision are exercised end to end by the
 * hermetic goldens (`activities/execute-cursor/__tests__/hermetic/`), which
 * pin their observable behavior byte for byte; nothing here re-drives a
 * client beyond the one bounded read the reinvocation asks, on a stub.
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ENGINE_EVENT_TYPES,
  REINVOCATION_EVENT_TYPES,
  fileReviewOn,
  isReinvocation,
  reconcileReinvocation,
  reconcileTurnSettlement,
  regeneratesApprovedWrites,
  runEventsReader,
  runWroteEngineEvents,
  type ResolutionDeps,
} from "../turn-context.js";

const INPUT = { executionId: "aex_1", threadId: "", turnSeq: 0 } as const;

describe("isReinvocation", () => {
  it("engine-minted: an empty state id is a first turn, any id is a resume", () => {
    expect(isReinvocation("engine-minted", INPUT, false)).toBe(false);
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42" }, false)).toBe(true);
  });

  it("engine-minted: turnSeq is NOT the signal (a pure-reconcile turn does not advance it; the legacy wire shape yields 0)", () => {
    expect(isReinvocation("engine-minted", { ...INPUT, turnSeq: 3 }, false)).toBe(false);
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42", turnSeq: 0 }, false)).toBe(true);
  });

  it("engine-minted: the log is NOT the signal (the bound id is; a follow-up turn with a bound id and nothing written still resumes the engine)", () => {
    expect(isReinvocation("engine-minted", { ...INPUT, threadId: "agent-42" }, false)).toBe(true);
    expect(isReinvocation("engine-minted", INPUT, true)).toBe(false);
  });

  it("deterministic: what the run's engine wrote to the log is the signal — nothing is a first run, any event is a continuation", () => {
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "thread-ses_1" }, false)).toBe(false);
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "thread-ses_1" }, true)).toBe(true);
  });

  it("deterministic: the thread id is NOT the signal (a deterministic harness has one on its first turn too)", () => {
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "thread-ses_1", turnSeq: 0 }, false)).toBe(false);
    expect(isReinvocation("deterministic", { ...INPUT, threadId: "", turnSeq: 0 }, true)).toBe(true);
  });
});

describe("runWroteEngineEvents", () => {
  it("asks the run's log for one event of the types only the engine's rows produce", async () => {
    const client = { hasRunSessionEvent: vi.fn(async () => true) };
    expect(await runWroteEngineEvents(client, "ses_1", "run_1")).toBe(true);
    expect(client.hasRunSessionEvent).toHaveBeenCalledExactlyOnceWith("ses_1", "run_1", ENGINE_EVENT_TYPES);
    // The server's user.message, the memory recall and a start's undo say nothing about the engine.
    expect(ENGINE_EVENT_TYPES).not.toContain("user.message");
    expect(ENGINE_EVENT_TYPES).not.toContain("stigmer.memory.recalled");
    expect(ENGINE_EVENT_TYPES).not.toContain("stigmer.file_review.reconciled");
  });
});

describe("reconcileReinvocation", () => {
  /** The phase's reads on a stub: a run whose engine wrote to the log, and a log read that answers `list`. */
  function reinvocationDeps(list: () => Promise<never[]>): {
    readonly deps: ResolutionDeps;
    readonly seed: ReturnType<typeof vi.fn>;
    readonly listRunSessionEvents: ReturnType<typeof vi.fn>;
  } {
    const seed = vi.fn();
    const listRunSessionEvents = vi.fn(list);
    const stub = {
      input: INPUT,
      client: { hasRunSessionEvent: vi.fn(async () => true), listRunSessionEvents },
      status: create(RunStatusSchema),
      transcript: { seed },
      enterPhase: vi.fn(),
    };
    return { deps: stub as unknown as ResolutionDeps, seed, listRunSessionEvents };
  }
  const args = { stateIdSource: "deterministic" as const, execution: create(RunSchema), sessionId: "ses_1" };

  it("fails the turn's start when the log cannot be read, and seeds nothing", async () => {
    const { deps, seed, listRunSessionEvents } = reinvocationDeps(async () => Promise.reject(new Error("log unreachable")));
    await expect(reconcileReinvocation(deps, args)).rejects.toThrow("log unreachable");
    expect(listRunSessionEvents).toHaveBeenCalledExactlyOnceWith("ses_1", INPUT.executionId, REINVOCATION_EVENT_TYPES);
    expect(seed, "a turn whose asks could not be read never starts on an empty seed").not.toHaveBeenCalled();
  });
});

describe("runEventsReader", () => {
  it("reads the run's events afresh on each call, and not before", async () => {
    const client = { listRunSessionEvents: vi.fn(async () => []) };
    const read = runEventsReader(client, "ses_1", "run_1");
    expect(client.listRunSessionEvents).not.toHaveBeenCalled();
    await read();
    await read();
    expect(client.listRunSessionEvents.mock.calls).toEqual([["ses_1", "run_1"], ["ses_1", "run_1"]]);
  });
});

describe("fileReviewOn", () => {
  const session = (fileReview: boolean) => create(SessionSchema, { spec: { fileReview } });
  const message = create(RunSpecSchema, { message: "Edit the notes." });
  const evalTry = create(RunSpecSchema, { message: "Edit the notes.", pluginEvalCase: {} });

  it("is off unless the session asks for it", () => {
    expect(fileReviewOn(session(false), message)).toBe(false);
    expect(fileReviewOn(create(SessionSchema, {}), message)).toBe(false);
    expect(fileReviewOn(session(true), message)).toBe(true);
  });

  it("is on for a plugin-eval try whatever the switch says: its graders read the captured sets", () => {
    expect(fileReviewOn(session(false), evalTry)).toBe(true);
    expect(fileReviewOn(session(true), evalTry)).toBe(true);
  });
});

describe("reconcileTurnSettlement", () => {
  it("nothing owed: a reconcile turn completes with nothing to say", () => {
    expect(reconcileTurnSettlement([])).toEqual({ kind: "file-review-resolved", failed: false, failureDetail: "", discardedPaths: [] });
  });

  it("names every file put back, across change sets", () => {
    expect(
      reconcileTurnSettlement([
        { changeSetId: "run_a:0", undonePaths: ["a.md"], failure: "", failureDetail: "" },
        { changeSetId: "run_b:0", undonePaths: ["b.md", "c.md"], failure: "", failureDetail: "" },
      ]),
    ).toEqual({ kind: "file-review-resolved", failed: false, failureDetail: "", discardedPaths: ["a.md", "b.md", "c.md"] });
  });

  it("a failed undo fails the settlement's copy and carries its detail", () => {
    expect(
      reconcileTurnSettlement([
        { changeSetId: "run_a:0", undonePaths: [], failure: "hash_mismatch", failureDetail: "a.md changed" },
        { changeSetId: "run_b:0", undonePaths: ["b.md"], failure: "", failureDetail: "" },
      ]),
    ).toEqual({ kind: "file-review-resolved", failed: true, failureDetail: "a.md changed", discardedPaths: ["b.md"] });
  });
});

describe("regeneratesApprovedWrites", () => {
  it("a deny-and-retry engine re-prompts the model with grants, so the runner pins the approved bytes", () => {
    expect(regeneratesApprovedWrites("deny-and-retry")).toBe(true);
  });

  it("a callback engine's resumed session re-attempts the call, so the runner pins the approved bytes", () => {
    expect(regeneratesApprovedWrites("callback")).toBe(true);
  });

  it("an interrupt engine applies the exact args it paused on — a runner-side write would land twice and pre-empt the row", () => {
    expect(regeneratesApprovedWrites("interrupt")).toBe(false);
  });

  it("a gate-less engine has nothing approved to apply", () => {
    expect(regeneratesApprovedWrites("none")).toBe(false);
  });
});
