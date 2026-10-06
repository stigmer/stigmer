// Unit tests for triggerSchedule, the `schedule trigger` dispatch: the fire is
// sent for the resolved schedule's id, and the result names the run's real
// outcome. A started run is a success naming the run, the command to watch it
// and the next cron fire; a refused run (a launch gate, or a target agent that
// is gone) is an error result relaying the server's reason verbatim with a
// hint that the fire is recorded; a schedule with no id is a usage error and
// fires nothing. The client is a double recording what it was asked.

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleRunOutcome,
  ScheduleTriggerResultSchema,
  type ScheduleTriggerResult,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import type { CommandResult } from "../../output/index.js";
import { triggerSchedule } from "../schedule.js";

const NEXT_FIRE = new Date("2026-10-07T09:00:00.000Z");

const nightly = create(ScheduleSchema, {
  metadata: { id: "sch_1", slug: "nightly", name: "Nightly digest" },
  status: { nextFireAt: timestampFromDate(NEXT_FIRE) },
});

/** A client whose schedule get answers `schedule` and whose trigger answers `result`. */
function double(schedule: Schedule, result: ScheduleTriggerResult): { client: Stigmer; triggered: string[] } {
  const triggered: string[] = [];
  const client = {
    schedule: {
      get: async () => schedule,
      trigger: async (id: string) => {
        triggered.push(id);
        return result;
      },
    },
  } as unknown as Stigmer;
  return { client, triggered };
}

function fields(result: CommandResult): Record<string, string> {
  return Object.fromEntries(result.sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])));
}

describe("triggerSchedule", () => {
  it("reports a started run with the command to watch it and the next cron fire", async () => {
    const { client, triggered } = double(
      nightly,
      create(ScheduleTriggerResultSchema, { schedule: nightly, outcome: ScheduleRunOutcome.STARTED, runId: "aex_7" }),
    );

    const result = await triggerSchedule(client, "sch_1", "acme");

    expect(triggered).toEqual(["sch_1"]);
    expect(result.status).toBe("success");
    expect(result.message).toBe("Schedule 'Nightly digest' fired — run started");
    expect(fields(result)).toEqual({
      Run: "aex_7",
      "Watch it": "stigmer get run aex_7",
      "Next cron fire": NEXT_FIRE.toISOString(),
    });
  });

  it("names the schedule read before the fire when the result carries none, by slug when unnamed", async () => {
    const unnamed = create(ScheduleSchema, { metadata: { id: "sch_1", slug: "nightly" } });
    const { client } = double(
      unnamed,
      create(ScheduleTriggerResultSchema, { outcome: ScheduleRunOutcome.STARTED, runId: "aex_8" }),
    );

    const result = await triggerSchedule(client, "sch_1", "acme");

    expect(result.message).toBe("Schedule 'nightly' fired — run started");
    expect(fields(result)).toEqual({ Run: "aex_8", "Watch it": "stigmer get run aex_8" });
  });

  it("reports a run a launch gate refused as an error, relaying the reason", async () => {
    const { client } = double(
      nightly,
      create(ScheduleTriggerResultSchema, {
        schedule: nightly,
        outcome: ScheduleRunOutcome.REFUSED,
        refusalReason: "monthly spend cap reached",
      }),
    );

    const result = await triggerSchedule(client, "sch_1", "acme");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Schedule 'Nightly digest' fired, but a launch gate refused the run");
    expect(fields(result)).toEqual({ Reason: "monthly spend cap reached" });
    expect(result.hints).toEqual([
      "The fire is recorded in the schedule's run history; fix the cause and trigger again.",
    ]);
  });

  it("reports a missing target agent as an error", async () => {
    const { client } = double(
      nightly,
      create(ScheduleTriggerResultSchema, {
        schedule: nightly,
        outcome: ScheduleRunOutcome.TARGET_MISSING,
        refusalReason: "agent acme/digest not found",
      }),
    );

    const result = await triggerSchedule(client, "sch_1", "acme");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Schedule 'Nightly digest' fired, but the target agent was not found");
    expect(fields(result)).toEqual({ Reason: "agent acme/digest not found" });
  });

  it("refuses a schedule with no id and fires nothing", async () => {
    const { client, triggered } = double(
      create(ScheduleSchema, { metadata: { slug: "nightly" } }),
      create(ScheduleTriggerResultSchema, {}),
    );

    await expect(triggerSchedule(client, "sch_1", "acme")).rejects.toThrow(
      new UsageError("Schedule 'sch_1' has no id — cannot trigger"),
    );
    expect(triggered).toEqual([]);
  });
});
