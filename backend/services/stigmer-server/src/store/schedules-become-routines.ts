/**
 * The data migration that renames the schedule kind to the routine kind
 * (SQLite v42, Postgres v38): what one row becomes, said once for both
 * drivers, which own the SQL, the pages and the transaction.
 *
 * What changes, and why each row must.
 *
 *   - The kind. `schedule`, kind string `Schedule`, becomes `routine`,
 *     `Routine`, by the shared rename (kind-rename.ts `renameKind` in each
 *     driver, with `ROUTINE_RENAME_V38`): every table keyed by kind,
 *     current and previous names included, and each row's kind string. The
 *     rows' bytes need nothing else: the spec's one-arm `target` oneof and
 *     the plain `agent` field that replaced it are the same bytes at the
 *     same number, and `cron` turning proto3 `optional` changes no byte. A
 *     row keeps its `sch_` id, which the kind table lists as a retired
 *     prefix, and its etag: it covers the spec's JSON, whose keys did not
 *     move.
 *   - Grants on a schedule. A grant names its resource's kind as a string
 *     and its id is derived from its triple, so a grant naming `schedule`
 *     is re-keyed to the `grt_` id the routine triple derives, its history
 *     with it (`rekeyedRoutineGrant`). An Owner grant becomes a
 *     Participant grant: a routine's owner is the account that created it
 *     alone, because every run acts as that account, so Owner is no longer
 *     grantable. A person granted Owner could fire the schedule and still
 *     can; changing what it runs is now its creator's.
 *   - The fire ledger. `schedule_runs` becomes `routine_fires`, keyed by
 *     `(routine_id, fire_id)`, because a fire of the routine's `fire` call is
 *     its own fire even in the second another happened, which the old key
 *     `(schedule_id, nominal_fire_time, origin)` cannot hold.
 *     `execution_id` becomes `run_id`, the origin `cron` becomes
 *     `schedule`, and `fired_by` starts empty. A stored fire's id is the
 *     name its run was given (`ROUTINE_FIRE_ID_AT_STEP_SQL`): before this
 *     step a manual fire named its run by the second it was pressed, so a
 *     manual and a schedule fire of one second shared one run, and the
 *     manual row's id takes `-manual` to keep both rows.
 *   - Runs a schedule started. The reserved label `stigmer.ai/schedule-id`
 *     becomes `stigmer.ai/routine-id` (`relabelledRoutineRun`), etag
 *     re-stamped, written unproven so the run list index's `routine` key
 *     (revision 9) derives at open.
 *
 * Temporal's artifacts are untouched: each carries the routine's kept id,
 * so a converted routine keeps firing on its schedule.
 *
 * Every name here is a frozen literal, never read off the contract, so a
 * later rename cannot change what this step does. An undecodable row fails
 * the step, naming it, the rule the other data migrations keep.
 *
 * Proven by __tests__/schedules-become-routines.test.ts and one end-to-end
 * case per driver (sqlite/__tests__/migrations.test.ts,
 * postgres/__tests__/migrations.postgres.test.ts).
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";

import { stampEtag, storedEtagOf } from "./etag.js";
import { GRANT_ID_PREFIX_V34, stepGrantId } from "./kind-rename.js";
import type { KindRename, RekeyedGrant } from "./kind-rename.js";

/** SQLite v42, Postgres v38: the schedule became a routine. */
export const ROUTINE_RENAME_V38: KindRename = {
  kind: ["schedule", "routine"],
  kindString: ["Schedule", "Routine"],
  schema: RoutineSchema,
  label: "the rename of the schedule to a routine",
};

/** The `kind` column value of the grant rows the step re-keys. */
export const ROUTINE_RENAME_GRANT_KIND = "grant";

/** The `kind` column value of the run rows the step relabels. */
export const ROUTINE_RENAME_RUN_KIND = "run";

/** The relation an Owner grant held, and the one it takes. */
export const ROUTINE_OWNER_RELATION_AT_STEP = "owner";
export const ROUTINE_PARTICIPANT_RELATION_AT_STEP = "participant";

/** The label a schedule stamped on every run it started, before the step. */
export const SCHEDULE_ID_LABEL_AT_STEP = "stigmer.ai/schedule-id";

/** The label a routine stamps on every run it starts, written here as the step's own constant. */
export const ROUTINE_ID_LABEL_AT_STEP = "stigmer.ai/routine-id";

/** The ledger's origin values before and after. */
export const SCHEDULE_ORIGIN_BEFORE_STEP = "cron";
export const SCHEDULE_ORIGIN_AT_STEP = "schedule";
export const MANUAL_ORIGIN_AT_STEP = "manual";

/** The suffix a manual fire's id takes when a schedule fire of its second holds the plain one. */
export const MANUAL_FIRE_ID_SUFFIX_AT_STEP = "-manual";

/** How many rows the step decodes per page. */
export const ROUTINE_RENAME_PAGE_SIZE = 500;

/**
 * A stored fire's id, as SQL both engines read alike: the name the fire's
 * run was given before this step (`scheduledExecutionName`, frozen),
 * the schedule id lowercased with `_` written `-`, then the nominal second
 * of `YYYY-MM-DDTHH:MM:SSZ` as `yyyymmddThhmmssZ` in lowercase. `ledger`
 * names the old table's alias.
 */
export function routineFireIdAtStepSql(ledger: string): string {
  const n = `${ledger}.nominal_fire_time`;
  return (
    `replace(lower(${ledger}.schedule_id), '_', '-') || '-' || ` +
    `substr(${n}, 1, 4) || substr(${n}, 6, 2) || substr(${n}, 9, 2) || 't' || ` +
    `substr(${n}, 12, 2) || substr(${n}, 15, 2) || substr(${n}, 18, 2) || 'z'`
  );
}

/**
 * The same id in TypeScript, for the step's tests to hold the SQL to: the
 * fire's id as the step computes it for a row of `scheduleId` at
 * `nominalFireTime`, with the manual suffix when `collides`.
 */
export function routineFireIdAtStep(
  scheduleId: string,
  nominalFireTime: string,
  collides: boolean,
): string {
  const n = nominalFireTime;
  const id =
    `${scheduleId.toLowerCase().replaceAll("_", "-")}-` +
    `${n.slice(0, 4)}${n.slice(5, 7)}${n.slice(8, 10)}t${n.slice(11, 13)}${n.slice(14, 16)}${n.slice(17, 19)}z`;
  return collides ? `${id}${MANUAL_FIRE_ID_SUFFIX_AT_STEP}` : id;
}

/**
 * The re-keyed grant of one grant row (or one history entry's copy of it)
 * whose resource is a schedule, under the routine triple's `grt_` id, an
 * Owner grant made a Participant grant; undefined when it names no
 * schedule. Throws when the bytes do not decode or the triple is
 * malformed.
 */
export function rekeyedRoutineGrant(data: Uint8Array): RekeyedGrant | undefined {
  const grant = fromBinary(GrantSchema, data);
  const spec = grant.spec;
  if (spec === undefined) {
    return undefined;
  }
  const [from, to] = ROUTINE_RENAME_V38.kind;
  let changed = false;
  for (const ref of [spec.resource, spec.principal]) {
    if (ref !== undefined && ref.kind === from) {
      ref.kind = to;
      changed = true;
    }
  }
  if (!changed) {
    return undefined;
  }
  if (spec.resource?.kind === to && spec.relation === ROUTINE_OWNER_RELATION_AT_STEP) {
    spec.relation = ROUTINE_PARTICIPANT_RELATION_AT_STEP;
  }
  const id = stepGrantId(GRANT_ID_PREFIX_V34, spec);
  if (grant.metadata !== undefined) {
    grant.metadata.id = id;
  }
  return { id, data: toBinary(GrantSchema, grant) };
}

/**
 * One run row with the schedule label written as the routine label, its
 * etag re-stamped when it holds one; undefined when the run carries no
 * schedule label. Throws when the bytes do not decode.
 */
export function relabelledRoutineRun(data: Uint8Array): Uint8Array | undefined {
  const run = fromBinary(RunSchema, data);
  const labels = run.metadata?.labels;
  const value = labels?.[SCHEDULE_ID_LABEL_AT_STEP];
  if (labels === undefined || value === undefined) {
    return undefined;
  }
  delete labels[SCHEDULE_ID_LABEL_AT_STEP];
  labels[ROUTINE_ID_LABEL_AT_STEP] ??= value;
  if ((storedEtagOf(RunSchema, run) ?? "") !== "") {
    stampEtag(RunSchema, run);
  }
  return toBinary(RunSchema, run);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRoutineRenameRowError(kind: string, id: string, error: unknown): Error {
  return new Error(
    `${kind} '${id}' cannot be read to rename the schedule kind to the routine kind: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}
