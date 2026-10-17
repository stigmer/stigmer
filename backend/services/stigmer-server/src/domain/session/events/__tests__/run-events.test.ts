/**
 * Pins the server's own reads of a turn from its session's log
 * (../run-events.ts) on a real store: a run's events and none of another
 * run's, oldest first, narrowed by type when asked; a run with no session
 * reads none; the newest structured answer of a run alone; and each run's
 * sub-agent threads counted from their creation events. A full read pages
 * on until a short page, each page continuing after the last seq it saw.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../../store/interface.js";
import type {
  SessionEventQuery,
  SessionEventRecord,
} from "../../../../store/session-events.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { draftOf } from "../codec.js";
import {
  RUN_EVENTS_PAGE_SIZE,
  readSessionEvents,
  runEventsOf,
  runTranscriptOf,
  structuredOutputOf,
  threadCountsOf,
} from "../run-events.js";
import { RunEventsBuilder, appendRunEvents } from "./run-events-fixture.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

async function seedRun(id: string, sessionId: string): Promise<Run> {
  const run = create(RunSchema, {
    metadata: { id, name: id, slug: id, org: "acme" },
    spec:
      sessionId === ""
        ? {}
        : { target: { case: "sessionId", value: sessionId } },
  });
  await temp.store.saveResource(ApiResourceKind.run, id, RunSchema, run);
  return run;
}

describe("a run's events", () => {
  it("reads the run's own events oldest first, narrowed by type when asked, and none for a run with no session", async () => {
    const first = await seedRun("run_a", "ses_1");
    const second = await seedRun("run_b", "ses_1");
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_a")
        .user("first")
        .turnMessage("On it.", [{ id: "c1", name: "lookup", result: "found" }])
        .build(),
    );
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_b").user("second").build(),
    );

    const events = await runEventsOf(temp.store, first);
    expect(events.map((event) => event.event.case)).toEqual([
      "userMessage",
      "agentMessage",
      "agentToolUse",
      "agentToolResult",
    ]);
    expect(events.map((event) => Number(event.seq))).toEqual([1, 2, 3, 4]);
    expect(
      (await runEventsOf(temp.store, first, ["agent.message"])).map(
        (e) => e.event.case,
      ),
    ).toEqual(["agentMessage"]);
    expect(
      (await runTranscriptOf(temp.store, second)).events.map((e) => e.runId),
    ).toEqual(["run_b"]);
    expect(await runEventsOf(temp.store, await seedRun("run_c", ""))).toEqual(
      [],
    );
  });

  it("reads the newest structured answer of the run alone, and none when it gave none", async () => {
    const answered = await seedRun("run_a", "ses_1");
    const silent = await seedRun("run_b", "ses_1");
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_a")
        .turnMessage("Done.")
        .structuredOutput({ label: "bug" })
        .build(),
    );
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_b").turnMessage("Done.").build(),
    );
    expect(await structuredOutputOf(temp.store, answered)).toEqual({
      label: "bug",
    });
    expect(await structuredOutputOf(temp.store, silent)).toBeUndefined();
    expect(
      await structuredOutputOf(temp.store, await seedRun("run_c", "")),
    ).toBeUndefined();
  });

  it("counts each run's sub-agent threads from their creation events", async () => {
    await seedRun("run_a", "ses_1");
    await seedRun("run_b", "ses_1");
    await seedRun("run_c", "ses_1");
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_a")
        .threadCreated("run_a.t1", "researcher")
        .threadCreated("run_a.t2", "writer")
        .build(),
    );
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_b")
        .threadCreated("run_b.t1", "researcher")
        .build(),
    );
    await appendRunEvents(
      temp.store,
      "ses_1",
      "acme",
      new RunEventsBuilder("run_c").turnMessage("Alone.").build(),
    );
    expect(
      Object.fromEntries(await threadCountsOf(temp.store, "ses_1")),
    ).toEqual({ run_a: 2, run_b: 1 });
    expect((await threadCountsOf(temp.store, "")).size).toBe(0);
  });
});

describe("a full read", () => {
  it("pages on until a short page, each page after the last seq it saw", async () => {
    const queries: SessionEventQuery[] = [];
    const [event] = new RunEventsBuilder("run_a").user("hi").build();
    const record = (seq: number): SessionEventRecord => ({
      ...draftOf(event!),
      sessionId: "ses_1",
      seq,
      processedAt: "2026-10-13T00:00:00.000Z",
    });
    const paged = {
      sessionEvents: {
        list: async (_sessionId: string, query: SessionEventQuery) => {
          queries.push(query);
          const start = (query.afterSeq ?? 0) + 1;
          const size = start === 1 ? RUN_EVENTS_PAGE_SIZE : 2;
          return Array.from({ length: size }, (_, index) =>
            record(start + index),
          );
        },
      },
    } as unknown as Store;
    const events = await readSessionEvents(paged, "ses_1", {
      runId: "run_a",
      types: ["user.message"],
    });
    expect(events).toHaveLength(RUN_EVENTS_PAGE_SIZE + 2);
    expect(queries.map((query) => query.afterSeq)).toEqual([
      undefined,
      RUN_EVENTS_PAGE_SIZE,
    ]);
    expect(queries[1]).toMatchObject({
      order: "asc",
      runId: "run_a",
      types: ["user.message"],
    });
  });
});
