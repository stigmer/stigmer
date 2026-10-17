// Unit tests for fireRoutine, the `routine fire` dispatch: the fire is sent
// for the resolved routine's id, and the result names the run's real
// outcome. A started run is a success naming the run, the command to watch it
// and the next scheduled fire; a refused run (a launch gate, or a target
// agent that is gone) is an error result relaying the server's reason
// verbatim with a hint that the fire is recorded; a routine with no id is a
// usage error and fires nothing. The client is a double recording what it was
// asked. The routine here keeps the `sch_` id a stored schedule was minted
// with, which still names it.

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RoutineSchema, type Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import {
  type FireRoutineInput,
  RoutineFireOutcome,
  RoutineFireResultSchema,
  type RoutineFireResult,
} from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import type { CommandResult } from "../../output/index.js";
import { fireRoutine } from "../routine.js";

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
