/**
 * Pins a session's state (../state.ts), computed from its log on read: the
 * newest session status event says it, a session with none reads idle,
 * and an event of another kind never decides it. On a real store, the one
 * indexed read answers the same, each session read alone, and stamping
 * sets the state on each session's status, creating the status when a
 * session has none.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import {
  readSessionState,
  sessionStateOf,
  stampSessionStates,
} from "../state.js";
import { RunEventsBuilder, appendRunEvents } from "./run-events-fixture.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
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

describe("a session's state", () => {
  it("is what the newest status event says, idle with none, and never another event's", () => {
    const events = new RunEventsBuilder("run_a")
      .sessionStatus("running")
      .turnMessage("Working.")
      .sessionStatus("idle")
      .build();
    expect(sessionStateOf(events)).toBe("idle");
    expect(sessionStateOf(events.slice(0, 2))).toBe("running");
    expect(
      sessionStateOf([...events].reverse()),
      "the newest by seq, whatever the order",
    ).toBe("idle");
    expect(sessionStateOf(events.slice(1, 2))).toBe("idle");
    expect(sessionStateOf([])).toBe("idle");
  });

  it("is read from the store per session, and stamped on each session's status", async () => {
    await seedRun("run_a", "ses_busy");
    await seedRun("run_b", "ses_done");
    await appendRunEvents(
      temp.store,
      "ses_busy",
      "acme",
      new RunEventsBuilder("run_a")
        .sessionStatus("running")
        .turnMessage("Working.")
        .build(),
    );
    await appendRunEvents(
      temp.store,
      "ses_done",
      "acme",
      new RunEventsBuilder("run_b")
        .sessionStatus("running")
        .sessionStatus("idle")
        .build(),
    );
    expect(await readSessionState(temp.store, "ses_busy")).toBe("running");
    expect(await readSessionState(temp.store, "ses_done")).toBe("idle");
    expect(await readSessionState(temp.store, "ses_fresh")).toBe("idle");

    const sessions = ["ses_busy", "ses_done", "ses_fresh"].map((id) =>
      create(SessionSchema, {
        metadata: { id },
        ...(id === "ses_done" ? { status: { agentId: "agt_1" } } : {}),
      }),
    );
    await stampSessionStates(temp.store, sessions);
    expect(sessions.map((session) => session.status?.state)).toEqual([
      "running",
      "idle",
      "idle",
    ]);
    expect(sessions[1]?.status?.agentId, "the rest of the status stays").toBe(
      "agt_1",
    );
  });
});
