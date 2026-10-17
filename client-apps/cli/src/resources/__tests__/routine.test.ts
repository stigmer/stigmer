// Unit tests for fireRoutine, the `routine fire` dispatch: the fire is sent
// for the resolved routine's id, and the result names the run's real
// outcome. A started run is a success naming the run, the command to watch it
// and the next scheduled fire; a refused run (a launch gate, or a target
// agent that is gone) is an error result relaying the server's reason
// verbatim with a hint that the fire is recorded; a routine with no id is a
// usage error and fires nothing. And for resumeRoutine, the `routine resume`
// dispatch: a paused routine's resume names what it cleared, one that was not
// paused says there was nothing to clear and when it next fires, a disabled
// one is told it will not run until enabled, and a routine with no id is a
// usage error that resumes nothing. The client is a double recording what it
// was asked. The routine here keeps the `sch_` id a stored schedule was
// minted with, which still names it.

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  type FireRoutineInput,
  RoutineFireOutcome,
  RoutineFireResultSchema,
  type RoutineFireResult,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import type { CommandResult } from "../../output/index.js";
import { fireRoutine, resumeRoutine } from "../routine.js";

const NEXT_FIRE = new Date("2026-10-07T09:00:00.000Z");

const nightly = create(RoutineSchema, {
  metadata: { id: "sch_1", slug: "nightly", name: "Nightly digest" },
  status: { nextFireAt: timestampFromDate(NEXT_FIRE) },
});

/** A client whose routine get answers `routine` and whose fire answers `result`. */
function double(routine: Routine, result: RoutineFireResult): { client: Stigmer; fired: string[] } {
  const fired: string[] = [];
  const client = {
    routine: {
      get: async () => routine,
      fire: async (input: FireRoutineInput) => {
        fired.push(input.id);
        return result;
      },
    },
  } as unknown as Stigmer;
  return { client, fired };
}

function fields(result: CommandResult): Record<string, string> {
  return Object.fromEntries(result.sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])));
}

describe("fireRoutine", () => {
  it("reports a started run with the command to watch it and the next scheduled fire", async () => {
    const { client, fired } = double(
      nightly,
      create(RoutineFireResultSchema, { routine: nightly, outcome: RoutineFireOutcome.STARTED, runId: "aex_7" }),
    );

    const result = await fireRoutine(client, "sch_1", "acme");

    expect(fired).toEqual(["sch_1"]);
    expect(result.status).toBe("success");
    expect(result.message).toBe("Routine 'Nightly digest' fired — run started");
    expect(fields(result)).toEqual({
      Run: "aex_7",
      "Watch it": "stigmer get run aex_7",
      "Next scheduled fire": NEXT_FIRE.toISOString(),
    });
  });

  it("names the routine read before the fire when the result carries none, by slug when unnamed", async () => {
    const unnamed = create(RoutineSchema, { metadata: { id: "sch_1", slug: "nightly" } });
    const { client } = double(
      unnamed,
      create(RoutineFireResultSchema, { outcome: RoutineFireOutcome.STARTED, runId: "aex_8" }),
    );

    const result = await fireRoutine(client, "sch_1", "acme");

    expect(result.message).toBe("Routine 'nightly' fired — run started");
    expect(fields(result)).toEqual({ Run: "aex_8", "Watch it": "stigmer get run aex_8" });
  });

  it("reports a run a launch gate refused as an error, relaying the reason", async () => {
    const { client } = double(
      nightly,
      create(RoutineFireResultSchema, {
        routine: nightly,
        outcome: RoutineFireOutcome.REFUSED,
        refusalReason: "monthly spend cap reached",
      }),
    );

    const result = await fireRoutine(client, "sch_1", "acme");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Routine 'Nightly digest' fired, but a launch gate refused the run");
    expect(fields(result)).toEqual({ Reason: "monthly spend cap reached" });
    expect(result.hints).toEqual([
      "The fire is recorded in the routine's fire history; fix the cause and fire it again.",
    ]);
  });

  it("reports a missing target agent as an error", async () => {
    const { client } = double(
      nightly,
      create(RoutineFireResultSchema, {
        routine: nightly,
        outcome: RoutineFireOutcome.TARGET_MISSING,
        refusalReason: "agent acme/digest not found",
      }),
    );

    const result = await fireRoutine(client, "sch_1", "acme");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Routine 'Nightly digest' fired, but the target agent was not found");
    expect(fields(result)).toEqual({ Reason: "agent acme/digest not found" });
  });

  it("refuses a routine with no id and fires nothing", async () => {
    const { client, fired } = double(
      create(RoutineSchema, { metadata: { slug: "nightly" } }),
      create(RoutineFireResultSchema, {}),
    );

    await expect(fireRoutine(client, "sch_1", "acme")).rejects.toThrow(
      new UsageError("Routine 'sch_1' has no id — cannot fire"),
    );
    expect(fired).toEqual([]);
  });
});

describe("resumeRoutine", () => {
  /** A client whose routine get answers `before` and whose resume answers `after`. */
  function resumable(before: Routine, after: Routine): { client: Stigmer; resumed: string[] } {
    const resumed: string[] = [];
    const client = {
      routine: {
        get: async () => before,
        resume: async (id: string) => {
          resumed.push(id);
          return after;
        },
      },
    } as unknown as Stigmer;
    return { client, resumed };
  }

  const cleared = create(RoutineSchema, {
    metadata: { id: "sch_1", slug: "nightly", name: "Nightly digest" },
    spec: { enabled: true },
    status: { nextFireAt: timestampFromDate(NEXT_FIRE) },
  });

  it("names the pause it cleared and the failures it reset", async () => {
    const paused = create(RoutineSchema, {
      metadata: { id: "sch_1", slug: "nightly", name: "Nightly digest" },
      spec: { enabled: true },
      status: { pausedReason: "Paused after 2 consecutive failed runs", consecutiveFailures: 2 },
    });
    const { client, resumed } = resumable(paused, cleared);

    const result = await resumeRoutine(client, "sch_1", "acme");

    expect(resumed).toEqual(["sch_1"]);
    expect(result.message).toBe("Routine 'Nightly digest' resumed");
    expect(fields(result)).toEqual({
      "Pause reason": "Paused after 2 consecutive failed runs",
      "Consecutive failures": "2",
      "Next fire": NEXT_FIRE.toISOString(),
    });
  });

  it("says there was nothing to clear for a routine that was not paused", async () => {
    const { client } = resumable(cleared, cleared);

    const result = await resumeRoutine(client, "sch_1", "acme");

    expect(result.message).toBe("Routine 'Nightly digest' was not paused — nothing to clear");
    expect(fields(result)).toEqual({ "Next fire": NEXT_FIRE.toISOString() });
  });

  it("tells a disabled routine's owner it will not run until enabled", async () => {
    const disabled = create(RoutineSchema, { metadata: { id: "sch_1", slug: "nightly" }, spec: { enabled: false } });
    const { client } = resumable(disabled, disabled);

    const result = await resumeRoutine(client, "sch_1", "acme");

    expect(result.message).toBe("Routine 'nightly' was not paused — nothing to clear");
    expect(result.hints[0]).toBe("This routine is disabled (enabled: false) — it will not run until you enable it:");
  });

  it("refuses a routine with no id and resumes nothing", async () => {
    const { client, resumed } = resumable(create(RoutineSchema, { metadata: { slug: "nightly" } }), cleared);

    await expect(resumeRoutine(client, "sch_1", "acme")).rejects.toThrow(
      new UsageError("Routine 'sch_1' has no id — cannot resume"),
    );
    expect(resumed).toEqual([]);
  });
});
