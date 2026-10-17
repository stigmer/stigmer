/**
 * Pins the driver-neutral half of the rename of the schedule kind to the
 * routine kind (../schedules-become-routines.ts):
 *   - a stored schedule row, written the way the releases before the step
 *     wrote it (the spec's one-arm `target` oneof at field 4), reads back
 *     as a routine whose bytes differ only in the kind string, its `sch_`
 *     id and its etag kept;
 *   - rekeyedRoutineGrant re-keys a grant on a schedule to the routine
 *     triple's `grt_` id, an Owner grant made a Participant grant and a
 *     Viewer grant kept a Viewer grant, and passes over a grant on another
 *     kind and a grant that holds no spec;
 *   - relabelledRoutineRun moves a run's schedule label to the routine
 *     label, keeps a routine label the row already holds, re-stamps an etag
 *     only on a row that had one, and passes over a run without the label;
 *   - the fire id the step's SQL computes is the name the fire's run was
 *     given (`scheduledExecutionName`), evaluated by a real SQL engine, and
 *     its TypeScript twin agrees, the manual suffix included;
 *   - the step's names are frozen literals, and its failure names the row
 *     and keeps the cause.
 */
import { DatabaseSync } from "node:sqlite";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { AgentInvocationSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";

import { canonicalTripleText } from "../../domain/grant/constants.js";
import { derivedId } from "../../pipeline/steps/defaults.js";
import { scheduledExecutionName } from "../../temporal/routine/run-starter.js";
import { etagOf } from "../etag.js";
import { renamedKindRow } from "../kind-rename.js";
import {
  MANUAL_FIRE_ID_SUFFIX_AT_STEP,
  ROUTINE_ID_LABEL_AT_STEP,
  ROUTINE_RENAME_V38,
  SCHEDULE_ID_LABEL_AT_STEP,
  rekeyedRoutineGrant,
  relabelledRoutineRun,
  routineFireIdAtStep,
  routineFireIdAtStepSql,
  unreadableRoutineRenameRowError,
} from "../schedules-become-routines.js";

const AGENT = toBinary(
  AgentInvocationSchema,
  create(AgentInvocationSchema, {
    agentRef: { org: "org_acme", id: "agt_helper" },
    message: "Send the reminders.",
  }),
);

/** A schedule row as a release before the step wrote it, field by field, with `kind` as given. */
function storedScheduleBytes(kind: string): Uint8Array {
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("0 9 * * *")
    .tag(2, WireType.LengthDelimited)
    .string("Asia/Kolkata")
    .tag(3, WireType.Varint)
    .bool(true)
    // The one arm of the `target` oneof: the same bytes the plain field writes.
    .tag(4, WireType.LengthDelimited)
    .bytes(AGENT)
    .finish();
  const metadata = toBinary(
    ApiResourceMetadataSchema,
    create(ApiResourceMetadataSchema, { id: "sch_01daily", org: "org_acme", name: "Daily", slug: "daily", etag: "etag-kept" }),
  );
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string(kind)
    .tag(3, WireType.LengthDelimited)
    .bytes(metadata)
    .tag(4, WireType.LengthDelimited)
    .bytes(spec)
    .finish();
}

describe("the step's names are frozen literals", () => {
  it("renames schedule to routine, and the schedule label to the routine label", () => {
    expect(ROUTINE_RENAME_V38.kind).toEqual(["schedule", "routine"]);
    expect(ROUTINE_RENAME_V38.kindString).toEqual(["Schedule", "Routine"]);
    expect(SCHEDULE_ID_LABEL_AT_STEP).toBe("stigmer.ai/schedule-id");
    expect(ROUTINE_ID_LABEL_AT_STEP).toBe("stigmer.ai/routine-id");
    expect(MANUAL_FIRE_ID_SUFFIX_AT_STEP).toBe("-manual");
  });
});

describe("a stored schedule row", () => {
  it("reads back as a routine whose bytes differ only in the kind string", () => {
    const renamed = renamedKindRow(ROUTINE_RENAME_V38, storedScheduleBytes("Schedule"));
    expect(renamed).toEqual(storedScheduleBytes("Routine"));
    const routine = fromBinary(RoutineSchema, renamed!);
    expect(routine.kind).toBe("Routine");
    expect(routine.metadata?.id).toBe("sch_01daily");
    expect(routine.metadata?.etag).toBe("etag-kept");
    expect(routine.spec?.cron).toBe("0 9 * * *");
    expect(routine.spec?.timeZone).toBe("Asia/Kolkata");
    expect(routine.spec?.enabled).toBe(true);
    expect(routine.spec?.agent?.message).toBe("Send the reminders.");
  });

  it("keeps its etag: the fingerprint of its spec, name and labels did not move", () => {
    const routine = fromBinary(RoutineSchema, renamedKindRow(ROUTINE_RENAME_V38, storedScheduleBytes("Schedule"))!);
    const restamped = create(RoutineSchema, routine);
    expect(etagOf(RoutineSchema, restamped)).toBe(etagOf(RoutineSchema, fromBinary(RoutineSchema, storedScheduleBytes("Routine"))));
  });
});

function grantBytes(relation: string, resourceKind: string): Uint8Array {
  return toBinary(
    GrantSchema,
    create(GrantSchema, {
      kind: "Grant",
      metadata: { id: "grt_old", org: "org_acme" },
      spec: {
        principal: { kind: "identity_account", id: "ida_bea" },
        resource: { kind: resourceKind, id: "sch_01daily" },
        relation,
      },
    }),
  );
}

describe("rekeyedRoutineGrant", () => {
  it("re-keys an Owner grant on a schedule as a Participant grant on the routine, under the routine triple's grt_ id", () => {
    const rekeyed = rekeyedRoutineGrant(grantBytes("owner", "schedule"))!;
    const grant = fromBinary(GrantSchema, rekeyed.data);
    expect(grant.spec?.resource?.kind).toBe("routine");
    expect(grant.spec?.relation).toBe("participant");
    expect(rekeyed.id).toBe(derivedId("grt", canonicalTripleText(grant.spec!)));
    expect(grant.metadata?.id).toBe(rekeyed.id);
  });

  it("keeps a Viewer grant a Viewer grant, re-keyed", () => {
    const grant = fromBinary(GrantSchema, rekeyedRoutineGrant(grantBytes("viewer", "schedule"))!.data);
    expect(grant.spec?.resource?.kind).toBe("routine");
    expect(grant.spec?.relation).toBe("viewer");
  });

  it("passes over a grant on another kind, Owner included", () => {
    expect(rekeyedRoutineGrant(grantBytes("owner", "agent"))).toBeUndefined();
  });

  it("passes over a grant that holds no spec", () => {
    const bare = toBinary(GrantSchema, create(GrantSchema, { metadata: { id: "grt_bare", org: "org_acme" } }));
    expect(rekeyedRoutineGrant(bare)).toBeUndefined();
  });

  it("fails on bytes that do not decode", () => {
    expect(() => rekeyedRoutineGrant(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });
});

function runBytes(labels: Record<string, string>, etag: string): Uint8Array {
  return toBinary(
    RunSchema,
    create(RunSchema, { kind: "Run", metadata: { id: "run_1", org: "org_acme", labels, etag } }),
  );
}

describe("relabelledRoutineRun", () => {
  it("moves the schedule label to the routine label and re-stamps the etag the row had", () => {
    const run = fromBinary(RunSchema, relabelledRoutineRun(runBytes({ [SCHEDULE_ID_LABEL_AT_STEP]: "sch_01daily" }, "old"))!);
    expect(run.metadata?.labels).toEqual({ [ROUTINE_ID_LABEL_AT_STEP]: "sch_01daily" });
    expect(run.metadata?.etag).toBe(etagOf(RunSchema, run));
  });

  it("stamps no etag on a row that had none", () => {
    const run = fromBinary(RunSchema, relabelledRoutineRun(runBytes({ [SCHEDULE_ID_LABEL_AT_STEP]: "sch_01daily" }, ""))!);
    expect(run.metadata?.etag).toBe("");
  });

  it("keeps a routine label the row already holds", () => {
    const run = fromBinary(
      RunSchema,
      relabelledRoutineRun(
        runBytes({ [SCHEDULE_ID_LABEL_AT_STEP]: "sch_01daily", [ROUTINE_ID_LABEL_AT_STEP]: "rtn_kept" }, ""),
      )!,
    );
    expect(run.metadata?.labels).toEqual({ [ROUTINE_ID_LABEL_AT_STEP]: "rtn_kept" });
  });

  it("passes over a run without the label", () => {
    expect(relabelledRoutineRun(runBytes({ "stigmer.ai/channel-id": "chn_1" }, ""))).toBeUndefined();
  });
});

describe("a stored fire's id", () => {
  const SAMPLES: ReadonlyArray<readonly [string, string]> = [
    ["sch_01DAILY", "2026-08-25T09:30:00Z"],
    ["sch_01jz0000000000000000000000", "2026-12-31T23:59:59Z"],
    ["sch_x_y", "2026-01-02T03:04:05Z"],
  ];

  it("is, by the step's own SQL on a real engine, the name the fire's run was given", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE s (schedule_id TEXT, nominal_fire_time TEXT)");
    const insert = db.prepare("INSERT INTO s VALUES (?, ?)");
    for (const [id, nominal] of SAMPLES) {
      insert.run(id, nominal);
    }
    const rows = db
      .prepare(`SELECT schedule_id, nominal_fire_time, ${routineFireIdAtStepSql("s")} AS fire_id FROM s ORDER BY schedule_id`)
      .all() as Array<{ schedule_id: string; nominal_fire_time: string; fire_id: string }>;
    for (const row of rows) {
      expect(row.fire_id).toBe(scheduledExecutionName(row.schedule_id, new Date(row.nominal_fire_time)));
    }
    db.close();
  });

  it("and the TypeScript twin agrees, a colliding manual fire taking the suffix", () => {
    for (const [id, nominal] of SAMPLES) {
      expect(routineFireIdAtStep(id, nominal, false)).toBe(scheduledExecutionName(id, new Date(nominal)));
      expect(routineFireIdAtStep(id, nominal, true)).toBe(`${scheduledExecutionName(id, new Date(nominal))}-manual`);
    }
  });
});

describe("the step's failure", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("bad bytes");
    const error = unreadableRoutineRenameRowError("grant", "grt_x", cause);
    expect(error.message).toBe("grant 'grt_x' cannot be read to rename the schedule kind to the routine kind: bad bytes");
    expect(error.cause).toBe(cause);
  });
});
