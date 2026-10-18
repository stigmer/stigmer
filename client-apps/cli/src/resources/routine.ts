// `routine resume`, `routine fire` and `routine fires` dispatch. Resume
// clears a platform auto-pause from a routine and reports what was cleared;
// fire starts it now, with an optional note for that run; fires lists its
// fire history.
//
// "Paused" is the platform's latch (status.paused_reason, written after
// repeated failed runs), distinct from "disabled", the owner's switch
// (spec.enabled) — two words, two levers (see docs/vocabulary.md). The
// resume RPC is deliberately the only path that clears the latch: applying
// a manifest preserves status verbatim, so no declarative apply can
// silently un-pause a failing routine.
//
// The pre-state read exists for honest messaging only: the RPC is
// idempotent and its response always shows a cleared latch, so "resumed"
// versus "was not paused" can only be told apart by looking first. The
// resume call is made either way — on the no-op path it doubles as a
// harmless re-arm of the routine's schedule.
//
// The fire history's table shows one row per fire, newest first: when it
// was recorded, whether the schedule or a caller started it, who that
// caller was (a person, or a service account whose key another system
// holds), the outcome, the run and the reason. The caller's name and the
// reason are text from outside the CLI (a profile, a launch gate's copy),
// so each passes through the one-line cleaning `runs scores` uses. yaml and
// json print the ledger rows as the server returned them.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  FireRoutineInputSchema,
  ListRoutineFiresRequestSchema,
  RoutineFireOrigin,
  RoutineFireOutcome,
  RoutineFireSchema,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { RoutineFire } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { UsageError } from "../errors/index.js";
import {
  CommandResult,
  renderEmpty,
  renderProtoListJson,
  renderProtoListYaml,
  renderTable,
} from "../output/index.js";
import { readCursorPages } from "./cursor-pages.js";
import { idPrefixesFor, parseReference } from "./reference.js";
import { oneLine } from "./run-scores.js";
import { requireOrganization } from "../client/single-org.js";

/** The routine kind's id prefixes (proto kind_meta): `rtn`, and `sch` for one stored while the kind was Schedule. */
const ROUTINE_ID_PREFIXES = idPrefixesFor(ApiResourceKind.routine);

/**
 * Resolve `ref` (an `rtn_…` or `sch_…` id, `org/slug`, or bare slug against `org`),
 * clear its platform pause, and describe the outcome.
 */
export async function resumeRoutine(stigmer: Stigmer, ref: string, org: string): Promise<CommandResult> {
  const before = await loadRoutine(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Routine '${ref}' has no id — cannot resume`);
  }

  const wasPausedReason = before.status?.pausedReason ?? "";
  const wasFailures = before.status?.consecutiveFailures ?? 0;

  const resumed = await stigmer.routine.resume(id);

  return describeOutcome(resumed, wasPausedReason, wasFailures);
}

async function loadRoutine(stigmer: Stigmer, ref: string, org: string): Promise<Routine> {
  const parsed = parseReference(ref, org, ROUTINE_ID_PREFIXES);
  if (parsed.kind === "id") {
    return stigmer.routine.get(parsed.id);
  }
  await requireOrganization(stigmer, parsed.org, [
    "stigmer config context set --org <org>",
    "stigmer routine <command> --org <org> ...",
  ]);
  return stigmer.routine.getByReference({ org: parsed.org, slug: parsed.slug });
}

/**
 * Resolve `ref` (an `rtn_…` or `sch_…` id, `org/slug`, or bare slug
 * against `org`) and fire it once, immediately, with `text` as the run's
 * note when one is given.
 *
 * The fire is SYNCHRONOUS: the RPC runs the full run create pipeline
 * and the result names the run's real outcome — the created run's
 * id, or the refusing gate's copy verbatim. A refused run renders as an
 * error result (non-zero exit) so a scripted test fire fails honestly,
 * but the fire itself succeeded: it is recorded in the routine's fire
 * history either way. A disabled routine is refused by the server with
 * teaching copy; the CLI relays the server's message verbatim (never
 * pattern-match refusal text).
 */
export async function fireRoutine(
  stigmer: Stigmer,
  ref: string,
  org: string,
  text?: string,
): Promise<CommandResult> {
  const before = await loadRoutine(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Routine '${ref}' has no id — cannot fire`);
  }

  const fired = await stigmer.routine.fire(
    create(FireRoutineInputSchema, text === undefined ? { id } : { id, text }),
  );
  const routine = fired.routine ?? before;
  const slug = routine.metadata?.slug ?? "";
  const name = routine.metadata?.name || slug;

  if (fired.outcome === RoutineFireOutcome.STARTED) {
    const result = CommandResult.success(`Routine '${name}' fired — run started`);
    const section = result.addSection();
    section.field("Run", fired.runId);
    section.field("Fire", fired.fireId);
    section.field("Watch it", `stigmer get run ${fired.runId}`);
    if (routine.status?.nextFireAt !== undefined) {
      section.field("Next scheduled fire", timestampDate(routine.status.nextFireAt).toISOString());
    }
    return result;
  }

  // The run was refused deterministically (a launch gate said no, or the
  // target agent is gone). The fire happened and is recorded in run
  // history; the refusing gate's copy relays verbatim.
  const what = fired.outcome === RoutineFireOutcome.TARGET_MISSING
    ? "the target agent was not found"
    : "a launch gate refused the run";
  const result = CommandResult.error(`Routine '${name}' fired, but ${what}`);
  const section = result.addSection();
  section.field("Reason", fired.refusalReason);
  result.hint(
    `The fire is recorded in the routine's fire history (stigmer routine fires ${ref}); fix the cause and fire it again.`,
  );
  return result;
}

function describeOutcome(routine: Routine, wasPausedReason: string, wasFailures: number): CommandResult {
  const slug = routine.metadata?.slug ?? "";
  const name = routine.metadata?.name || slug;
  const wasPaused = wasPausedReason !== "" || wasFailures > 0;

  const result = CommandResult.success(
    wasPaused ? `Routine '${name}' resumed` : `Routine '${name}' was not paused — nothing to clear`,
  );

  if (wasPaused) {
    const section = result.addSection("Cleared");
    if (wasPausedReason !== "") section.field("Pause reason", wasPausedReason);
    if (wasFailures > 0) section.field("Consecutive failures", String(wasFailures));
  }

  if (routine.spec?.enabled !== true) {
    result.hint("This routine is disabled (enabled: false) — it will not run until you enable it:");
    result.hint(`  edit the manifest to 'enabled: true' and run: stigmer apply -f <file>`);
  } else if (routine.status?.nextFireAt !== undefined) {
    result.addSection().field("Next fire", timestampDate(routine.status.nextFireAt).toISOString());
  }

  return result;
}

/** Output format for a fire history: a table, or the ledger rows as the server returned them. */
export type FiresFormat = "table" | "yaml" | "json";

export interface FiresStreams {
  write(text: string): void;
}

const FIRES_HEADERS = ["FIRED", "ORIGIN", "STARTED BY", "OUTCOME", "RUN", "REASON"] as const;

/**
 * Resolve `ref` and render its newest `limit` fires (0 reads every page).
 */
export async function showRoutineFires(
  stigmer: Stigmer,
  ref: string,
  org: string,
  limit: number,
  format: FiresFormat,
  streams: FiresStreams = defaultStreams(),
): Promise<void> {
  const routine = await loadRoutine(stigmer, ref, org);
  const routineId = routine.metadata?.id ?? "";
  if (routineId === "") {
    throw new UsageError(`Routine '${ref}' has no id — cannot list its fires`);
  }
  const fires = await readCursorPages(limit, (pageSize, pageToken) =>
    stigmer.routine.listFires(create(ListRoutineFiresRequestSchema, { routineId, pageSize, pageToken })),
  );
  if (format === "yaml") {
    streams.write(renderProtoListYaml(RoutineFireSchema, fires));
    return;
  }
  if (format === "json") {
    streams.write(renderProtoListJson(RoutineFireSchema, fires));
    return;
  }
  streams.write(renderFiresTable(fires));
}

/** The table view of a fire history; a routine never fired says so. */
export function renderFiresTable(fires: readonly RoutineFire[]): string {
  if (fires.length === 0) {
    return renderEmpty("fires");
  }
  return `\n${renderTable(FIRES_HEADERS, fires.map(fireRow))}\n`;
}

function fireRow(fire: RoutineFire): string[] {
  return [
    fire.recordedAt === undefined ? "" : timestampDate(fire.recordedAt).toISOString(),
    ORIGIN_LABELS[fire.origin],
    startedBy(fire),
    OUTCOME_LABELS[fire.outcome],
    fire.runId,
    oneLine(fire.reason),
  ];
}

/** How a fire began, in words; keyed by every origin, so it stays exhaustive. */
const ORIGIN_LABELS: Readonly<Record<RoutineFireOrigin, string>> = {
  [RoutineFireOrigin.UNSPECIFIED]: "",
  [RoutineFireOrigin.SCHEDULE]: "Scheduled",
  [RoutineFireOrigin.MANUAL]: "Manual",
};

/** What a fire produced, in words; keyed by every outcome, so it stays exhaustive. */
const OUTCOME_LABELS: Readonly<Record<RoutineFireOutcome, string>> = {
  [RoutineFireOutcome.UNSPECIFIED]: "",
  [RoutineFireOutcome.STARTED]: "started",
  [RoutineFireOutcome.REFUSED]: "refused",
  [RoutineFireOutcome.TARGET_MISSING]: "agent missing",
  [RoutineFireOutcome.SKIPPED]: "skipped",
  [RoutineFireOutcome.COMPLETED]: "completed",
  [RoutineFireOutcome.FAILED]: "failed",
  [RoutineFireOutcome.TIMED_OUT]: "timed out",
};

/**
 * Who started a fire: the caller's name, else email, else id, and the id
 * of the service account whose key minted an app user's token when there
 * is one. A schedule fire has no caller; its origin already says so.
 */
function startedBy(fire: RoutineFire): string {
  const actor = fire.firedBy;
  const who = oneLine(actor?.displayName || actor?.email || actor?.id || "");
  if (who === "") {
    return "—";
  }
  const mintedBy = oneLine(actor?.mintedBy ?? "");
  return mintedBy === "" ? who : `${who} (through service account ${mintedBy})`;
}

function defaultStreams(): FiresStreams {
  return { write: (text: string) => void process.stdout.write(text) };
}
