/**
 * Pins the run writes that keep a session's log in step with its runs
 * (../run-writes.ts) on a real store: the session reads running while any
 * turn works and idle only when the last one stops, a working run's
 * removal ends the turn, a stale in-memory copy never decides the events,
 * and a run in no session writes none. Each committed event also reaches
 * the session's live streams.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../broker.js";
import { eventTypeOf } from "../catalog.js";
import { eventOf } from "../codec.js";
import {
  createRunAppendingEvents,
  overwriteRunAppendingEvents,
  removeRunAppendingEvents,
  updateRunAppendingEvents,
} from "../run-writes.js";
import type { RunEventWriteDeps } from "../run-writes.js";
import { readSessionState } from "../state.js";

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
