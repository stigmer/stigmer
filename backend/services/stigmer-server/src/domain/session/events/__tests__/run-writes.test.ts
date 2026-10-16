/**
 * Pins the run writes that keep a session's log in step with its runs
 * (../run-writes.ts) on a real store: the session reads running while any
 * turn works and idle only when the last one stops, a working run's
 * removal ends the turn, a stale in-memory copy never decides the events,
 * and a run in no session writes none. Each committed event also reaches
 * the session's live streams. An update is handed the run of the
 * session's newest event of a type only when it asks, and an update's own
 * events land where it puts them: its first before the transition's
 * events, its last (the file-review decisions it records) after them, each
 * once, and none for a run in no session.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { createLogger } from "../../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../../store/interface.js";
import type { Store } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../broker.js";
import { eventOf } from "../codec.js";
import {
  createRunAppendingEvents,
  overwriteRunAppendingEvents,
  removeRunAppendingEvents,
  runCreateWriter,
  runRemover,
  updateRunAppendingEvents,
} from "../run-writes.js";
import type { RunEventWriteDeps } from "../run-writes.js";
import { readSessionState } from "../state.js";
import { decidedEvent } from "../../../run/filereview/decided.js";
import type { ActionWord, OriginWord, ScopeWord } from "../../filereview/words.js";

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

/** The session's log as run:type, without each turn's own stigmer.run.status (pinned in its own block). */
async function log(sessionId: string): Promise<string[]> {
  return (await fullLog(sessionId)).filter((entry) => !entry.endsWith(":stigmer.run.status"));
}

async function fullLog(sessionId: string): Promise<string[]> {
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

describe("each turn's own status", () => {
  it("every phase change of a run commits its stigmer.run.status with the run, whatever the session does", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await createRunAppendingEvents(deps, run("b", "s1"));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_IN_PROGRESS));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_IN_PROGRESS));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    const records = await temp.store.sessionEvents.list("s1", { order: "asc", limit: 100, types: ["stigmer.run.status"] });
    expect(
      records.map((record) => {
        const event = eventOf(record).event;
        return `${record.runId}:${event.case === "stigmerRunStatus" ? event.value.phase : ""}`;
      }),
    ).toEqual(["a:pending", "b:pending", "a:running", "a:completed"]);
    expect(await fullLog("s1")).toContain("a:stigmer.run.status");
  });
});

describe("delivery and edges", () => {
  it("each committed event reaches the session's live streams, in order", async () => {
    const stream = deps.sessionEventBroker.subscribe("s1", []);
    await createRunAppendingEvents(deps, run("a", "s1"));
    expect(stream.queue.map((f) => (f.frame.case === "event" ? eventTypeOf(f.frame.value) : ""))).toEqual([
      "user.message",
      "stigmer.run.status",
      "session.status_running",
    ]);
    expect(stream.queue.map((f) => (f.frame.case === "event" ? f.frame.value.seq : 0n))).toEqual([1n, 2n, 3n]);
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
          args[3](undefined, {
            othersWorking: 0,
            latestStateType: undefined,
            latestState: undefined,
            runOfNewestType: undefined,
            othersWaiting: [],
            gates: [],
            runEvents: [],
          });
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
    await updateRunAppendingEvents(deps, "a", (_r, session) => void seen.push(session.runOfNewestType), {
      runOfNewestType: "user.message",
    });
    await updateRunAppendingEvents(deps, "a", (_r, session) => void seen.push(session.runOfNewestType));
    expect(seen).toEqual(["b", undefined]);
  });
});

/** A decision on run `runId`'s change set, as its writers record it. */
function decision(
  runId: string,
  changeSetId: string,
  scope: ScopeWord,
  action: ActionWord,
  origin: OriginWord,
  fileChangeId = "",
) {
  return decidedEvent(runId, {
    changeSetId,
    scope,
    fileChangeId,
    action,
    expectedDigest: `digest-${fileChangeId || changeSetId}`,
    origin,
    reason: "because",
    decidedBy: origin === "person" ? "usr_ada" : "",
  });
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

describe("an update's own events", () => {
  it("its last events come after the transition's, as given", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    const undo = decision("a", "a:0", "file", "undo", "person", "fc1");
    await updateRunAppendingEvents(deps, "a", (r) => {
      setPhase(RunPhase.RUN_COMPLETED)(r);
      return { last: [undo] };
    });
    expect(await log("s1")).toEqual([
      "a:user.message",
      "a:session.status_running",
      "a:session.status_idle",
      "a:stigmer.file_review.decided",
    ]);
    const [decided] = await decidedEvents("s1");
    expect(decided).toMatchObject({
      runId: "a",
      id: undo.event.value?.id,
      changeSetId: "a:0",
      scope: "file",
      fileChangeId: "fc1",
      action: "undo",
      expectedDigest: "digest-fc1",
      origin: "person",
      reason: "because",
      decidedBy: "usr_ada",
    });
  });

  it("a second decision on a target the log holds fails the whole write: its writers read the log first and never send one", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", () => ({ last: [decision("a", "a:0", "change_set", "keep", "person")] }));
    await expect(
      updateRunAppendingEvents(deps, "a", (r) => {
        setPhase(RunPhase.RUN_COMPLETED)(r);
        return { last: [decision("a", "a:0", "change_set", "undo", "person")] };
      }),
    ).rejects.toThrow();
    expect((await decidedEvents("s1")).map((d) => d.action)).toEqual(["keep"]);
    expect((await temp.store.getResource(ApiResourceKind.run, "a", RunSchema)).status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("every decision of one update lands in the order given", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", () => ({
      last: [
        decision("a", "a:0", "change_set", "keep", "approved_command"),
        decision("a", "a:1", "change_set", "keep", "eval_try"),
        decision("a", "a:2", "file", "keep", "next_turn", "fc9"),
      ],
    }));
    const decided = await decidedEvents("s1");
    expect(decided.map((d) => [d.changeSetId, d.scope, d.fileChangeId, d.origin, d.decidedBy])).toEqual([
      ["a:0", "change_set", "", "approved_command", ""],
      ["a:1", "change_set", "", "eval_try", ""],
      ["a:2", "file", "fc9", "next_turn", ""],
    ]);
  });

  it("a bare list is the update's first events, and an empty result writes only the transition's", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", () => [decision("a", "a:0", "change_set", "keep", "person")]);
    await updateRunAppendingEvents(deps, "a", () => ({}));
    expect(await decidedEvents("s1")).toHaveLength(1);
  });

  it("a run in no session writes no event of its own", async () => {
    await createRunAppendingEvents(deps, run("a", ""));
    const { events } = await updateRunAppendingEvents(deps, "a", () => ({
      first: [decision("a", "a:0", "change_set", "keep", "person")],
      last: [decision("a", "a:1", "change_set", "keep", "person")],
    }));
    expect(events).toEqual([]);
  });
});
