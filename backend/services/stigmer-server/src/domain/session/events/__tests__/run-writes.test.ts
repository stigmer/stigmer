/**
 * Pins the run writes that keep a session's log in step with its runs
 * (../run-writes.ts) on a real store: the session reads running while any
 * turn works and idle only when the last one stops, a working run's
 * removal ends the turn, a stale in-memory copy never decides the events,
 * and a run in no session writes none. Each committed event also reaches
 * the session's live streams. An update is handed the run of the
 * session's newest event of a type only when it asks, and every file
 * decision an update adds to the run's ledger is mirrored as one
 * `stigmer.file_review.decided` event in the event's words, once.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  FileReviewEventType,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { FileDecisionSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../../store/interface.js";
import type { Store } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../broker.js";
import { eventTypeOf } from "../catalog.js";
import { eventOf } from "../codec.js";
import {
  createRunAppendingEvents,
  fileReviewDecidedEventId,
  overwriteRunAppendingEvents,
  removeRunAppendingEvents,
  runCreateWriter,
  runRemover,
  updateRunAppendingEvents,
} from "../run-writes.js";
import type { RunEventWriteDeps } from "../run-writes.js";
import { readSessionState } from "../state.js";
import {
  eventId,
  recordFileDecisionEventWithActor,
} from "../../../run/filereview/author.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore;
let deps: RunEventWriteDeps;

beforeEach(() => {
  temp = tempStore();
  deps = { store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) };
});

afterEach(async () => {
  await temp.cleanup();
});

function run(id: string, sessionId: string, phase = RunPhase.RUN_PENDING, message = `turn ${id}`): Run {
  return create(RunSchema, {
    metadata: { id, org: "acme" },
    spec: { target: sessionId === "" ? { case: undefined } : { case: "sessionId", value: sessionId }, message },
    status: { phase },
  });
}

function setPhase(phase: RunPhase, error = ""): (r: Run) => void {
  return (r) => {
    r.status!.phase = phase;
    r.status!.error = error;
  };
}

async function log(sessionId: string): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(sessionId, { order: "asc", limit: 100 });
  return records.map((record) => `${record.runId}:${eventTypeOf(eventOf(record))}`);
}

describe("one turn", () => {
  it("create, work, finish: the user message, running, then idle", async () => {
    await createRunAppendingEvents(deps, run("r1", "s1"));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    await updateRunAppendingEvents(deps, "r1", setPhase(RunPhase.RUN_IN_PROGRESS));
    await updateRunAppendingEvents(deps, "r1", setPhase(RunPhase.RUN_COMPLETED));
    expect(await log("s1")).toEqual(["r1:user.message", "r1:session.status_running", "r1:session.status_idle"]);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
  });

  it("a failed turn reports its error, then idles as retries_exhausted", async () => {
    await createRunAppendingEvents(deps, run("r1", "s1"));
    await updateRunAppendingEvents(deps, "r1", setPhase(RunPhase.RUN_FAILED, "boom"));
    expect(await log("s1")).toEqual([
      "r1:user.message",
      "r1:session.status_running",
      "r1:session.error",
      "r1:session.status_idle",
    ]);
  });

  it("an update answers the committed phase it started from, and a missing run is not found", async () => {
    await createRunAppendingEvents(deps, run("r1", "s1"));
    const { previousPhase, run: updated } = await updateRunAppendingEvents(deps, "r1", setPhase(RunPhase.RUN_IN_PROGRESS));
    expect(previousPhase).toBe(RunPhase.RUN_PENDING);
    expect(updated.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    await expect(updateRunAppendingEvents(deps, "r_absent", setPhase(RunPhase.RUN_COMPLETED))).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});

describe("two turns in one session", () => {
  it("stays running until the last turn stops, whichever stops first", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await createRunAppendingEvents(deps, run("b", "s1"));
    await updateRunAppendingEvents(deps, "b", setPhase(RunPhase.RUN_COMPLETED));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    expect(await log("s1")).toEqual(["a:user.message", "a:session.status_running", "b:user.message", "a:session.status_idle"]);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
  });

  it("another session's work never holds this one running", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await createRunAppendingEvents(deps, run("x", "s2"));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    expect(await readSessionState(temp.store, "s2")).toBe("running");
  });

  it("a paused turn is not working: the session idles, and running again on resume", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_PAUSED));
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_IN_PROGRESS));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
  });
});

describe("removing a run", () => {
  it("removing the only working run ends the session's turn; its own events go, the session's status stays", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await removeRunAppendingEvents(deps, "a");
    expect(await log("s1")).toEqual(["a:session.status_running", "a:session.status_idle"]);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    await expect(temp.store.getResource(ApiResourceKind.run, "a", RunSchema)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("removing a working run while another works keeps the session running", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await createRunAppendingEvents(deps, run("b", "s1"));
    await removeRunAppendingEvents(deps, "b");
    expect(await readSessionState(temp.store, "s1")).toBe("running");
  });

  it("removing a run that is not stored is no error", async () => {
    await expect(removeRunAppendingEvents(deps, "r_absent")).resolves.toBeUndefined();
  });
});

describe("an overwrite from a copy held in memory", () => {
  it("decides its events from the committed row, never the copy", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    // A stale copy still says waiting; the committed run already finished
    // and its idle is written: the overwrite writes no second idle.
    const stale = run("a", "s1", RunPhase.RUN_FAILED);
    const { previousPhase } = await overwriteRunAppendingEvents(deps, stale);
    expect(previousPhase).toBe(RunPhase.RUN_COMPLETED);
    expect(await log("s1")).toEqual(["a:user.message", "a:session.status_running", "a:session.status_idle"]);
  });

  it("writes the copy over the stored row, and refuses a run no longer stored", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await overwriteRunAppendingEvents(deps, run("a", "s1", RunPhase.RUN_FAILED));
    const stored = await temp.store.getResource(ApiResourceKind.run, "a", RunSchema);
    expect(stored.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    await expect(overwriteRunAppendingEvents(deps, run("gone", "s1", RunPhase.RUN_FAILED))).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});

describe("delivery and edges", () => {
  it("each committed event reaches the session's live streams, in order", async () => {
    const stream = deps.sessionEventBroker.subscribe("s1", []);
    await createRunAppendingEvents(deps, run("a", "s1"));
    expect(stream.queue.map((f) => (f.frame.case === "event" ? eventTypeOf(f.frame.value) : ""))).toEqual([
      "user.message",
      "session.status_running",
    ]);
    expect(stream.queue.map((f) => (f.frame.case === "event" ? f.frame.value.seq : 0n))).toEqual([1n, 2n]);
  });

  it("a run in no session writes no events", async () => {
    await createRunAppendingEvents(deps, run("a", ""));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    const stored = await temp.store.getResource(ApiResourceKind.run, "a", RunSchema);
    expect(stored.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("a session with no status event reads idle", async () => {
    expect(await readSessionState(temp.store, "s_new")).toBe("idle");
  });
});

describe("the chain writers and store faults", () => {
  it("the create chain's writer and the delete chain's remover write through the event writes", async () => {
    await runCreateWriter(deps)(run("a", "s1"));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    await runRemover(deps)("a");
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
  });

  it("an update whose row vanished under the lock is not found", async () => {
    const vanished: RunEventWriteDeps = {
      ...deps,
      store: {
        writeResourceAppendingEvents: async (...args: Parameters<Store["writeResourceAppendingEvents"]>) => {
          args[3](undefined, { othersWorking: 0, latestStateType: undefined, runOfNewestType: undefined });
          throw new Error("unreachable");
        },
      } as unknown as Store,
    };
    await expect(updateRunAppendingEvents(vanished, "a", setPhase(RunPhase.RUN_COMPLETED))).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("a removal's store fault is a fault, never 'already gone'", async () => {
    const faulty: RunEventWriteDeps = {
      ...deps,
      store: { writeResourceAppendingEvents: () => Promise.reject(new Error("database is locked")) } as unknown as Store,
    };
    await expect(removeRunAppendingEvents(faulty, "a")).rejects.toThrow("database is locked");
  });
});

describe("a log that drifted from its runs", () => {
  it("a run working from before the log holds the session running from the next write on, and the last stop idles it", async () => {
    // Written before the log existed: working, and no status event.
    await temp.store.saveResource(ApiResourceKind.run, "old", RunSchema, run("old", "s1", RunPhase.RUN_IN_PROGRESS));
    await createRunAppendingEvents(deps, run("new", "s1"));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    await updateRunAppendingEvents(deps, "new", setPhase(RunPhase.RUN_COMPLETED));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    await updateRunAppendingEvents(deps, "old", setPhase(RunPhase.RUN_COMPLETED));
    expect(await log("s1")).toEqual(["new:user.message", "new:session.status_running", "old:session.status_idle"]);
  });
});

describe("the session's newest turn", () => {
  it("an update that asks is handed the run of the newest user.message; one that does not is handed none", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await createRunAppendingEvents(deps, run("b", "s1"));
    const seen: Array<string | undefined> = [];
    await updateRunAppendingEvents(deps, "a", (_r, session) => seen.push(session.runOfNewestType), {
      runOfNewestType: "user.message",
    });
    await updateRunAppendingEvents(deps, "a", (_r, session) => seen.push(session.runOfNewestType));
    expect(seen).toEqual(["b", undefined]);
  });
});

/** Records a decision on `r`'s ledger as its writers do, under the update's lock. */
function decide(
  changeSetId: string,
  scope: FileDecisionScope,
  action: FileDecisionAction,
  origin: FileDecisionOrigin,
  fileChangeId = "",
): (r: Run) => void {
  return (r) => {
    const decision = create(FileDecisionSchema, {
      changeSetId,
      fileChangeId,
      scope,
      action,
      origin,
      expectedDigest: `digest-${fileChangeId || changeSetId}`,
      reason: "because",
      decidedAt: "2026-10-12T09:00:00Z",
    });
    decision.id = `${changeSetId}:${scope === FileDecisionScope.FILE ? fileChangeId : changeSetId}`;
    recordFileDecisionEventWithActor(r.status!, r.metadata!.id, decision, "user");
  };
}

async function decidedEvents(sessionId: string) {
  const records = await temp.store.sessionEvents.list(sessionId, {
    order: "asc",
    types: ["stigmer.file_review.decided"],
    limit: 100,
  });
  return records.map((record) => {
    const event = eventOf(record);
    if (event.event.case !== "stigmerFileReviewDecided") {
      throw new Error(`not a decided event: ${event.event.case ?? "none"}`);
    }
    return { runId: event.runId, ...event.event.value, processedAt: "" };
  });
}

describe("the decided mirror", () => {
  it("one decided event per decision the update added, after the transition's events, in the event's words", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", (r) => {
      setPhase(RunPhase.RUN_COMPLETED)(r);
      decide("a:0", FileDecisionScope.FILE, FileDecisionAction.REJECT, FileDecisionOrigin.USER, "fc1")(r);
    });
    expect(await log("s1")).toEqual([
      "a:user.message",
      "a:session.status_running",
      "a:session.status_idle",
      "a:stigmer.file_review.decided",
    ]);
    const ledgerId = eventId("a:0", "fc1", FileReviewEventType.FILE_DECIDED);
    const [decided] = await decidedEvents("s1");
    expect(decided).toMatchObject({
      runId: "a",
      id: fileReviewDecidedEventId(ledgerId),
      changeSetId: "a:0",
      scope: "file",
      fileChangeId: "fc1",
      action: "undo",
      expectedDigest: "digest-fc1",
      origin: "person",
      reason: "because",
    });
  });

  it("the id is sevt_fd_ and the first 40 hex of the sha256 of the ledger event's id", () => {
    // sha256("x") = 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881
    expect(fileReviewDecidedEventId("x")).toBe("sevt_fd_2d711642b726b04401627ca9fbac32f5c8530fb1");
  });

  it("a repeated decision adds no ledger event and appends nothing", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    const keep = decide("a:0", FileDecisionScope.CHANGE_SET, FileDecisionAction.APPROVE, FileDecisionOrigin.USER);
    await updateRunAppendingEvents(deps, "a", keep);
    await updateRunAppendingEvents(deps, "a", keep);
    await updateRunAppendingEvents(deps, "a", decide("a:0", FileDecisionScope.CHANGE_SET, FileDecisionAction.REJECT, FileDecisionOrigin.USER));
    expect((await decidedEvents("s1")).map((d) => d.action)).toEqual(["keep"]);
  });

  it("every decision of one update is mirrored, in ledger order, each origin in its word; a change-set decision names no file", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", (r) => {
      decide("a:0", FileDecisionScope.CHANGE_SET, FileDecisionAction.APPROVE, FileDecisionOrigin.POLICY_APPROVED_COMMAND)(r);
      decide("a:1", FileDecisionScope.CHANGE_SET, FileDecisionAction.APPROVE, FileDecisionOrigin.POLICY_EVAL_TRY)(r);
      decide("a:2", FileDecisionScope.FILE, FileDecisionAction.APPROVE, FileDecisionOrigin.POLICY_NEXT_TURN, "fc9")(r);
      decide("a:3", FileDecisionScope.CHANGE_SET, FileDecisionAction.REJECT, FileDecisionOrigin.UNSPECIFIED)(r);
    });
    const decided = await decidedEvents("s1");
    expect(decided.map((d) => [d.changeSetId, d.scope, d.fileChangeId, d.action, d.origin])).toEqual([
      ["a:0", "change_set", "", "keep", "approved_command"],
      ["a:1", "change_set", "", "keep", "eval_try"],
      ["a:2", "file", "fc9", "keep", "next_turn"],
      ["a:3", "change_set", "", "undo", "person"],
    ]);
  });

  it("a decision with no scope or no action has no word, so no event", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", (r) => {
      decide("a:0", FileDecisionScope.UNSPECIFIED, FileDecisionAction.APPROVE, FileDecisionOrigin.USER)(r);
      decide("a:1", FileDecisionScope.CHANGE_SET, FileDecisionAction.UNSPECIFIED, FileDecisionOrigin.USER)(r);
    });
    expect(await decidedEvents("s1")).toEqual([]);
  });

  it("a run in no session records its decision and writes no event", async () => {
    await createRunAppendingEvents(deps, run("a", ""));
    const { run: updated } = await updateRunAppendingEvents(
      deps,
      "a",
      decide("a:0", FileDecisionScope.CHANGE_SET, FileDecisionAction.APPROVE, FileDecisionOrigin.USER),
    );
    expect(updated.status?.fileReviewEventStream?.events).toHaveLength(1);
  });
});
