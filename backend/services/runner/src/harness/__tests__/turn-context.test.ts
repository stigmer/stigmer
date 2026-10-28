/**
 * Pins the turn context's pure decisions — the places `turn-context.ts`
 * decides something rather than fetching it:
 *
 *  - `reconcileReinvocation`'s first question, the runtime's one reading of
 *    "does this invocation resume rather than begin": whether the log holds
 *    an event the run's engine wrote (`runWroteEngineEvents`, one bounded
 *    read of the types only an engine's rows produce), whatever the thread
 *    id says (the id exists on the first turn too), and never the live
 *    engine checkpoint.
 *  - `fileReviewOn`: a turn's file review is on when the session asks for
 *    it or the run is a eval-run try, and off otherwise (the default).
 *  - `reconcileTurnSettlement`: a reconcile turn completes, its rows naming
 *    the files put back, or the failures when any undo failed.
 *  - `reconcileReinvocation`: a resumed invocation's seed and answers come
 *    from one read of the run's log (`transcript/resume-seed.ts`,
 *    `approval-answers.ts`); when that read fails, the turn's start fails,
 *    never a turn that runs with no asks and no answers.
 *
 * The phases that fetch and provision are exercised end to end by the
 * runtime's own suite (`run-turn.test.ts`) and each harness's hermetic
 * suite; nothing here re-drives a client beyond the reinvocation's bounded
 * reads, on a stub.
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  ENGINE_EVENT_TYPES,
  REINVOCATION_EVENT_TYPES,
  fileReviewOn,
  reconcileReinvocation,
  reconcileTurnSettlement,
  runFinishedWhileWaiting,
  runWroteEngineEvents,
  stopIsExplained,
  type ResolutionDeps,
} from "../turn-context.js";
import { TERMINAL_COPY } from "../terminal-table.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const INPUT = { executionId: "aex_1", threadId: "", turnSeq: 0 } as const;

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
      rows: create(TurnRowsSchema),
      transcript: { seed },
      enterPhase: vi.fn(),
    };
    return { deps: stub as unknown as ResolutionDeps, seed, listRunSessionEvents };
  }
  const args = { execution: create(RunSchema), sessionId: "ses_1" };

  it("reads a run whose engine wrote nothing as a first invocation, whatever the thread id says, and reads no more of the log", async () => {
    const { deps, seed, listRunSessionEvents } = reinvocationDeps(async () => []);
    const client = deps.client as unknown as { hasRunSessionEvent: ReturnType<typeof vi.fn> };
    client.hasRunSessionEvent.mockResolvedValue(false);
    const reinvocation = await reconcileReinvocation({ ...deps, input: { ...INPUT, threadId: "thread-ses_1" } }, args);
    expect(reinvocation.isReinvocation).toBe(false);
    expect(reinvocation.continuation).toBeUndefined();
    expect(listRunSessionEvents).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
  });

  it("reads a run whose engine wrote to the log as a continuation, even with no thread id", async () => {
    const { deps } = reinvocationDeps(async () => []);
    const reinvocation = await reconcileReinvocation(deps, args);
    expect(reinvocation.isReinvocation).toBe(true);
    expect(reinvocation.continuation).toEqual({});
  });

  it("fails the turn's start when the log cannot be read, and seeds nothing", async () => {
    const { deps, seed, listRunSessionEvents } = reinvocationDeps(async () => Promise.reject(new Error("log unreachable")));
    await expect(reconcileReinvocation(deps, args)).rejects.toThrow("log unreachable");
    expect(listRunSessionEvents).toHaveBeenCalledExactlyOnceWith("ses_1", INPUT.executionId, REINVOCATION_EVENT_TYPES);
    expect(seed, "a turn whose asks could not be read never starts on an empty seed").not.toHaveBeenCalled();
  });
});

describe("fileReviewOn", () => {
  const session = (fileReview: boolean) => create(SessionSchema, { spec: { fileReview } });
  const message = create(RunSpecSchema, { message: "Edit the notes." });
  const evalTry = create(RunSpecSchema, { message: "Edit the notes.", evalCase: {} });

  it("is off unless the session asks for it", () => {
    expect(fileReviewOn(session(false), message)).toBe(false);
    expect(fileReviewOn(create(SessionSchema, {}), message)).toBe(false);
    expect(fileReviewOn(session(true), message)).toBe(true);
  });

  it("is on for a eval-run try whatever the switch says: its graders read the captured sets", () => {
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

describe("runFinishedWhileWaiting", () => {
  /** A stub whose run reads back in `phase`; the read is counted. */
  function depsIn(phase: RunPhase): { readonly deps: ResolutionDeps; readonly getExecution: ReturnType<typeof vi.fn> } {
    const getExecution = vi.fn(async () => create(RunSchema, { status: create(RunStatusSchema, { phase }) }));
    return { deps: { input: INPUT, client: { getExecution } } as unknown as ResolutionDeps, getExecution };
  }

  it("reads nothing for a turn that did not wait", async () => {
    const { deps, getExecution } = depsIn(RunPhase.RUN_COMPLETED);
    expect(await runFinishedWhileWaiting(deps, false)).toBeUndefined();
    expect(getExecution).not.toHaveBeenCalled();
  });

  it("runs on when the run it waited for is still going", async () => {
    const { deps, getExecution } = depsIn(RunPhase.RUN_IN_PROGRESS);
    expect(await runFinishedWhileWaiting(deps, true)).toBeUndefined();
    expect(getExecution).toHaveBeenCalledWith("aex_1");
  });

  it("settles as the stored phase when the run finished while it waited", async () => {
    const { deps } = depsIn(RunPhase.RUN_COMPLETED);
    expect((await runFinishedWhileWaiting(deps, true))?.status.phase).toBe(RunPhase.RUN_COMPLETED);
  });
});

describe("stopIsExplained", () => {
  type EventValue = NonNullable<Parameters<typeof create<typeof SessionEventSchema>>[1]>["event"];
  const ev = (event: EventValue): SessionEvent => create(SessionEventSchema, { runId: "aex_1", event });
  const message = ev({ case: "agentMessage", value: { id: "aex_1.m1", content: [{ type: "text", text: "Working." }] } });
  const toolUse = ev({ case: "agentToolUse", value: { id: "aex_1.c1", name: "shell", input: {} } });
  const note = (text: string): SessionEvent => ev({ case: "stigmerHarnessNote", value: { id: "aex_1.n1", text } });
  const status = (phase: string): SessionEvent => ev({ case: "stigmerRunStatus", value: { id: "aex_1.s1", phase } });

  it("is false for a run whose engine wrote and then went silent: a lost runner", () => {
    expect(stopIsExplained([message, toolUse])).toBe(false);
  });

  it("is true once a continuation note or a pause follows the engine's last write", () => {
    expect(stopIsExplained([message, note(TERMINAL_COPY.continuation.notes.drain)])).toBe(true);
    expect(stopIsExplained([message, status("paused")])).toBe(true);
  });

  it("is false again when the engine wrote after the explained stop: that later stop is unexplained", () => {
    expect(stopIsExplained([note(TERMINAL_COPY.continuation.notes.drain), toolUse])).toBe(false);
    expect(stopIsExplained([status("paused"), message])).toBe(false);
  });

  it("reads a note of the engine's own, and a status that is no pause, as no explanation", () => {
    expect(stopIsExplained([message, note("Compacted the conversation.")])).toBe(false);
    expect(stopIsExplained([message, status("running")])).toBe(false);
  });
});
