// Unit tests for fireRoutine, the `routine fire` dispatch: the fire is sent
// for the resolved routine's id, with the note when one is given and with no
// text field at all when none is, and the result names the run's real
// outcome. A started run is a success naming the run, the fire, the command
// to watch it and the next scheduled fire; a refused run (a launch gate, or a
// target agent that is gone) is an error result relaying the server's reason
// verbatim with a hint naming the fire history; a routine with no id is a
// usage error and fires nothing. For resumeRoutine, the `routine resume`
// dispatch: a paused routine's resume names what it cleared, one that was not
// paused says there was nothing to clear and when it next fires, a disabled
// one is told it will not run until enabled, and a routine with no id is a
// usage error that resumes nothing. For showRoutineFires, the `routine
// fires` view: the history is asked for by the resolved routine's id and
// read up to the limit, one row per fire says when, how it began, who
// started it (with the service account behind an app user's token), the
// outcome, the run and the reason, a schedule fire shows no caller, a
// caller's name and a reason from outside the CLI cannot break the table or
// reach the terminal as escape codes, an empty history says so, and yaml and
// json print the rows. The client is a double recording what it was asked.

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  type FireRoutineInput,
  type ListRoutineFiresRequest,
  RoutineFireListSchema,
  RoutineFireOrigin,
  RoutineFireOutcome,
  RoutineFireResultSchema,
  RoutineFireSchema,
  type RoutineFire,
  type RoutineFireResult,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import { describe, expect, it, vi } from "vitest";
import { UsageError } from "../../errors/index.js";
import type { CommandResult } from "../../output/index.js";
import { fireRoutine, renderFiresTable, resumeRoutine, showRoutineFires } from "../routine.js";

const NEXT_FIRE = new Date("2026-10-07T09:00:00.000Z");

const nightly = create(RoutineSchema, {
  metadata: { id: "rtn_1", slug: "nightly", name: "Nightly digest" },
  status: { nextFireAt: timestampFromDate(NEXT_FIRE) },
});

/** A client whose routine get answers `routine` and whose fire answers `result`. */
function double(
  routine: Routine,
  result: RoutineFireResult,
): { client: Stigmer; fired: string[]; inputs: FireRoutineInput[] } {
  const fired: string[] = [];
  const inputs: FireRoutineInput[] = [];
  const client = {
    routine: {
      get: async () => routine,
      fire: async (input: FireRoutineInput) => {
        fired.push(input.id);
        inputs.push(input);
        return result;
      },
    },
  } as unknown as Stigmer;
  return { client, fired, inputs };
}

function fields(result: CommandResult): Record<string, string> {
  return Object.fromEntries(result.sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])));
}

describe("fireRoutine", () => {
  it("reports a started run with its fire, the command to watch it and the next scheduled fire", async () => {
    const { client, fired } = double(
      nightly,
      create(RoutineFireResultSchema, {
        routine: nightly,
        outcome: RoutineFireOutcome.STARTED,
        runId: "run_7",
        fireId: "manual-20261018-a1b2",
      }),
    );

    const result = await fireRoutine(client, "rtn_1", "acme");

    expect(fired).toEqual(["rtn_1"]);
    expect(result.status).toBe("success");
    expect(result.message).toBe("Routine 'Nightly digest' fired — run started");
    expect(fields(result)).toEqual({
      Run: "run_7",
      Fire: "manual-20261018-a1b2",
      "Watch it": "stigmer get run run_7",
      "Next scheduled fire": NEXT_FIRE.toISOString(),
    });
  });

  it("sends the note as the fire's text", async () => {
    const { client, inputs } = double(
      nightly,
      create(RoutineFireResultSchema, { routine: nightly, outcome: RoutineFireOutcome.STARTED, runId: "run_7" }),
    );

    await fireRoutine(client, "rtn_1", "acme", "Sentry alert SEN-4521 fired");

    expect(inputs.map((input) => ({ id: input.id, text: input.text }))).toEqual([
      { id: "rtn_1", text: "Sentry alert SEN-4521 fired" },
    ]);
  });

  it("sends no text when no note is given", async () => {
    const { client, inputs } = double(
      nightly,
      create(RoutineFireResultSchema, { routine: nightly, outcome: RoutineFireOutcome.STARTED, runId: "run_7" }),
    );

    await fireRoutine(client, "rtn_1", "acme");

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.text).toBe("");
  });

  it("names the routine read before the fire when the result carries none, by slug when unnamed", async () => {
    const unnamed = create(RoutineSchema, { metadata: { id: "rtn_1", slug: "nightly" } });
    const { client } = double(
      unnamed,
      create(RoutineFireResultSchema, { outcome: RoutineFireOutcome.STARTED, runId: "run_8" }),
    );

    const result = await fireRoutine(client, "rtn_1", "acme");

    expect(result.message).toBe("Routine 'nightly' fired — run started");
    expect(fields(result)).toEqual({ Run: "run_8", Fire: "", "Watch it": "stigmer get run run_8" });
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

    const result = await fireRoutine(client, "rtn_1", "acme");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Routine 'Nightly digest' fired, but a launch gate refused the run");
    expect(fields(result)).toEqual({ Reason: "monthly spend cap reached" });
    expect(result.hints).toEqual([
      "The fire is recorded in the routine's fire history (stigmer routine fires rtn_1); fix the cause and fire it again.",
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

    const result = await fireRoutine(client, "rtn_1", "acme");

    expect(result.status).toBe("error");
    expect(result.message).toBe("Routine 'Nightly digest' fired, but the target agent was not found");
    expect(fields(result)).toEqual({ Reason: "agent acme/digest not found" });
  });

  it("refuses a routine with no id and fires nothing", async () => {
    const { client, fired } = double(
      create(RoutineSchema, { metadata: { slug: "nightly" } }),
      create(RoutineFireResultSchema, {}),
    );

    await expect(fireRoutine(client, "rtn_1", "acme")).rejects.toThrow(
      new UsageError("Routine 'rtn_1' has no id — cannot fire"),
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
    metadata: { id: "rtn_1", slug: "nightly", name: "Nightly digest" },
    spec: { enabled: true },
    status: { nextFireAt: timestampFromDate(NEXT_FIRE) },
  });

  it("names the pause it cleared and the failures it reset", async () => {
    const paused = create(RoutineSchema, {
      metadata: { id: "rtn_1", slug: "nightly", name: "Nightly digest" },
      spec: { enabled: true },
      status: { pausedReason: "Paused after 2 consecutive failed runs", consecutiveFailures: 2 },
    });
    const { client, resumed } = resumable(paused, cleared);

    const result = await resumeRoutine(client, "rtn_1", "acme");

    expect(resumed).toEqual(["rtn_1"]);
    expect(result.message).toBe("Routine 'Nightly digest' resumed");
    expect(fields(result)).toEqual({
      "Pause reason": "Paused after 2 consecutive failed runs",
      "Consecutive failures": "2",
      "Next fire": NEXT_FIRE.toISOString(),
    });
  });

  it("says there was nothing to clear for a routine that was not paused", async () => {
    const { client } = resumable(cleared, cleared);

    const result = await resumeRoutine(client, "rtn_1", "acme");

    expect(result.message).toBe("Routine 'Nightly digest' was not paused — nothing to clear");
    expect(fields(result)).toEqual({ "Next fire": NEXT_FIRE.toISOString() });
  });

  it("tells a disabled routine's owner it will not run until enabled", async () => {
    const disabled = create(RoutineSchema, { metadata: { id: "rtn_1", slug: "nightly" }, spec: { enabled: false } });
    const { client } = resumable(disabled, disabled);

    const result = await resumeRoutine(client, "rtn_1", "acme");

    expect(result.message).toBe("Routine 'nightly' was not paused — nothing to clear");
    expect(result.hints[0]).toBe("This routine is disabled (enabled: false) — it will not run until you enable it:");
  });

  it("refuses a routine with no id and resumes nothing", async () => {
    const { client, resumed } = resumable(create(RoutineSchema, { metadata: { slug: "nightly" } }), cleared);

    await expect(resumeRoutine(client, "rtn_1", "acme")).rejects.toThrow(
      new UsageError("Routine 'rtn_1' has no id — cannot resume"),
    );
    expect(resumed).toEqual([]);
  });
});

describe("showRoutineFires", () => {
  const RECORDED = new Date("2026-10-18T08:30:00.000Z");

  const scheduled = create(RoutineFireSchema, {
    routineId: "rtn_1",
    origin: RoutineFireOrigin.SCHEDULE,
    outcome: RoutineFireOutcome.COMPLETED,
    runId: "run_1",
    recordedAt: timestampFromDate(RECORDED),
  });

  const byPerson = create(RoutineFireSchema, {
    routineId: "rtn_1",
    origin: RoutineFireOrigin.MANUAL,
    outcome: RoutineFireOutcome.STARTED,
    runId: "run_2",
    recordedAt: timestampFromDate(RECORDED),
    firedBy: { id: "ida_ana", email: "ana@example.com", displayName: "Ana" },
  });

  const byAlerting = create(RoutineFireSchema, {
    routineId: "rtn_1",
    origin: RoutineFireOrigin.MANUAL,
    outcome: RoutineFireOutcome.REFUSED,
    reason: "monthly spend cap reached",
    recordedAt: timestampFromDate(RECORDED),
    firedBy: { id: "ida_app", email: "pager@example.com", mintedBy: "ida_alerting" },
  });

  /** A client whose routine get answers `nightly` and whose fire history is `pages`, one read per page. */
  function history(pages: RoutineFire[][]): { client: Stigmer; asked: ListRoutineFiresRequest[] } {
    const asked: ListRoutineFiresRequest[] = [];
    const client = {
      routine: {
        get: async () => nightly,
        listFires: async (request: ListRoutineFiresRequest) => {
          const index = asked.length;
          asked.push(request);
          return create(RoutineFireListSchema, {
            entries: pages[index] ?? [],
            nextPageToken: index + 1 < pages.length ? `page-${index + 1}` : "",
          });
        },
      },
    } as unknown as Stigmer;
    return { client, asked };
  }

  function captured(): { write(text: string): void; text(): string } {
    const out: string[] = [];
    return { write: (text: string) => void out.push(text), text: () => out.join("") };
  }

  it("lists the resolved routine's fires with who started each", async () => {
    const { client, asked } = history([[byPerson, byAlerting, scheduled]]);
    const streams = captured();

    await showRoutineFires(client, "rtn_1", "acme", 50, "table", streams);

    expect(asked.map((request) => request.routineId)).toEqual(["rtn_1"]);
    const lines = streams.text().trim().split("\n");
    expect(lines[0]).toMatch(/^FIRED\s+ORIGIN\s+STARTED BY\s+OUTCOME\s+RUN\s+REASON$/);
    expect(lines[2]).toMatch(/Manual\s+Ana\s+started\s+run_2/);
    expect(lines[3]).toMatch(
      /Manual\s+pager@example\.com \(through service account ida_alerting\)\s+refused\s+monthly spend cap reached/,
    );
    expect(lines[4]).toMatch(/Scheduled\s+—\s+completed\s+run_1/);
    expect(lines[2]).toContain(RECORDED.toISOString());
  });

  it("reads no more than the limit, across pages", async () => {
    const { client, asked } = history([[byPerson, byAlerting], [scheduled, byPerson]]);
    const streams = captured();

    await showRoutineFires(client, "rtn_1", "acme", 3, "json", streams);

    expect(asked.map((request) => [request.pageSize, request.pageToken])).toEqual([
      [3, ""],
      [1, "page-1"],
    ]);
    expect(JSON.parse(streams.text())).toHaveLength(3);
  });

  it("writes to standard output when no streams are given", async () => {
    const { client } = history([[byPerson]]);
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await showRoutineFires(client, "rtn_1", "acme", 50, "json");
    } finally {
      write.mockRestore();
    }
    expect(JSON.parse(written.join(""))).toHaveLength(1);
  });

  it("reads every page with a limit of zero", async () => {
    const { client, asked } = history([[byPerson], [byAlerting], [scheduled]]);
    const streams = captured();

    await showRoutineFires(client, "rtn_1", "acme", 0, "yaml", streams);

    expect(asked).toHaveLength(3);
    expect(streams.text()).toContain("monthly spend cap reached");
  });

  it("says so when the routine has never fired", () => {
    expect(renderFiresTable([])).toBe("\nNo fires found\n\n");
  });

  it("keeps a caller's name and a reason on one line, with no escape codes", () => {
    const hostile = create(RoutineFireSchema, {
      origin: RoutineFireOrigin.MANUAL,
      outcome: RoutineFireOutcome.REFUSED,
      reason: "refused\n\u001b[31mFAKE ROW\u001b[0m\r\nmore",
      firedBy: { displayName: "Mallory\n\u001b[2Jcleared" },
    });

    const table = renderFiresTable([hostile]);

    expect(table).not.toContain("\u001b");
    // The header, its rule, and one row.
    expect(table.trim().split("\n")).toHaveLength(3);
    expect(table).toContain("Mallory [2Jcleared");
    expect(table).toContain("refused [31mFAKE ROW [0m more");
  });

  it("refuses a routine with no id and lists nothing", async () => {
    const asked: ListRoutineFiresRequest[] = [];
    const client = {
      routine: {
        get: async () => create(RoutineSchema, { metadata: { slug: "nightly" } }),
        listFires: async (request: ListRoutineFiresRequest) => {
          asked.push(request);
          return create(RoutineFireListSchema, {});
        },
      },
    } as unknown as Stigmer;

    await expect(showRoutineFires(client, "rtn_1", "acme", 50, "table", captured())).rejects.toThrow(
      new UsageError("Routine 'rtn_1' has no id — cannot list its fires"),
    );
    expect(asked).toEqual([]);
  });
});
