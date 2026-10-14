/**
 * Pins working time (../working-time.ts): a running event paired with the
 * next idle event, the stretch credited to the run whose running event
 * opened it; an open stretch counted up to the clock; a wait for a person
 * (an idle requires_action between two running events) never counted; a
 * second run's work inside an open stretch credited to the opening run;
 * an extra running or idle event changing nothing; and, on a real store,
 * one typed read per distinct session, other events never read as status.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { SessionEventRecord } from "../../../../store/session-events.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { draftOf } from "../codec.js";
import { workingMillisByRun, workingMillisOfSessions } from "../working-time.js";
import { RunEventsBuilder, appendRunEvents } from "./run-events-fixture.js";

const T0 = Date.UTC(2026, 9, 14, 9, 0, 0);

/** A status record as the store returns it, at `atMs`. */
function status(
  kind: "running" | "idle",
  runId: string,
  atMs: number,
  seq: number,
): SessionEventRecord {
  return {
    eventId: `sevt_${String(seq)}`,
    runId,
    threadId: "",
    type: kind === "running" ? "session.status_running" : "session.status_idle",
    data: new Uint8Array(),
    sessionId: "ses_1",
    seq,
    processedAt: new Date(atMs).toISOString(),
  };
}

describe("pairing a session's status events", () => {
  it("credits each stretch to the run whose running event opened it", () => {
    const byRun = workingMillisByRun(
      [
        status("running", "run_a", T0, 1),
        status("idle", "run_a", T0 + 4_000, 2),
        status("running", "run_b", T0 + 60_000, 3),
        status("idle", "run_b", T0 + 61_500, 4),
      ],
      new Date(T0 + 120_000),
    );
    expect([...byRun]).toEqual([
      ["run_a", 4_000],
      ["run_b", 1_500],
    ]);
  });

  it("counts an open stretch up to the clock", () => {
    const byRun = workingMillisByRun([status("running", "run_a", T0, 1)], new Date(T0 + 9_250));
    expect(byRun.get("run_a")).toBe(9_250);
  });

  it("never counts a wait for a person: idle requires_action, then running again on the answer", () => {
    const byRun = workingMillisByRun(
      [
        status("running", "run_a", T0, 1),
        status("idle", "run_a", T0 + 2_000, 2),
        status("running", "run_a", T0 + 302_000, 3),
        status("idle", "run_a", T0 + 305_000, 4),
      ],
      new Date(T0 + 400_000),
    );
    expect(byRun.get("run_a"), "2 s, then 3 s, and not the 300 s wait").toBe(5_000);
  });

  it("puts a second run's work inside an open stretch in the opening run's figure", () => {
    const byRun = workingMillisByRun(
      [
        status("running", "run_a", T0, 1),
        status("running", "run_b", T0 + 1_000, 2),
        status("idle", "run_b", T0 + 7_000, 3),
      ],
      new Date(T0 + 10_000),
    );
    expect([...byRun]).toEqual([["run_a", 7_000]]);
  });

  it("ignores an idle event while no stretch is open, and a stretch whose end precedes its start counts zero", () => {
    const byRun = workingMillisByRun(
      [
        status("idle", "run_a", T0, 1),
        status("idle", "run_a", T0 + 1_000, 2),
        status("running", "run_a", T0 + 5_000, 3),
        status("idle", "run_a", T0 + 4_000, 4),
      ],
      new Date(T0 + 10_000),
    );
    expect([...byRun]).toEqual([["run_a", 0]]);
  });

  it("reads nothing from an empty log", () => {
    expect(workingMillisByRun([], new Date(T0)).size).toBe(0);
  });
});

describe("reading working time from the store", () => {
  let temp: TempStore;

  beforeEach(() => {
    temp = tempStore();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await temp.cleanup();
  });

  async function seedRun(id: string, sessionId: string): Promise<void> {
    await temp.store.saveResource(
      ApiResourceKind.run,
      id,
      RunSchema,
      create(RunSchema, {
        metadata: { id, name: id, slug: id, org: "acme" },
        spec: { target: { case: "sessionId", value: sessionId } },
      }),
    );
  }

  /** Appends one event of `runId` to `sessionId`, accepted at `atMs`. */
  async function appendAt(sessionId: string, atMs: number, event: SessionEvent): Promise<void> {
    vi.setSystemTime(atMs);
    await temp.store.sessionEvents.append(sessionId, "acme", [draftOf(event)], {
      kind: ApiResourceKind.run,
      id: event.runId,
      schema: RunSchema,
      admit: () => undefined,
    });
  }

  function running(runId: string, id: string): SessionEvent {
    return create(SessionEventSchema, { runId, event: { case: "sessionStatusRunning", value: { id } } });
  }

  function idle(runId: string, id: string): SessionEvent {
    return create(SessionEventSchema, {
      runId,
      event: { case: "sessionStatusIdle", value: { id, stopReason: { type: "end_turn" } } },
    });
  }

  it("reads each distinct session once and merges the runs of every session", async () => {
    await seedRun("run_a", "ses_1");
    await seedRun("run_b", "ses_2");
    await appendAt("ses_1", T0, running("run_a", "sevt_a1"));
    await appendRunEvents(temp.store, "ses_1", "acme", new RunEventsBuilder("run_a").user("hello").build());
    await appendAt("ses_1", T0 + 3_000, idle("run_a", "sevt_a2"));
    await appendAt("ses_2", T0 + 10_000, running("run_b", "sevt_b1"));

    const list = vi.spyOn(temp.store.sessionEvents, "list");
    const byRun = await workingMillisOfSessions(temp.store, ["ses_1", "", "ses_2", "ses_1"], new Date(T0 + 12_000));

    expect(Object.fromEntries(byRun)).toEqual({ run_a: 3_000, run_b: 2_000 });
    expect(list.mock.calls.map(([sessionId, query]) => [sessionId, query.types])).toEqual([
      ["ses_1", ["session.status_running", "session.status_idle"]],
      ["ses_2", ["session.status_running", "session.status_idle"]],
    ]);
  });
});
