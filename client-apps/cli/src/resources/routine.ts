// `routine resume` and `routine fire` dispatch. Resume clears a platform
// auto-pause from a routine and reports what was cleared.
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

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { FireRoutineInputSchema, RoutineFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { idPrefixesFor, parseReference } from "./reference.js";
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
    "stigmer routine resume --org <org> ...",
  ]);
  return stigmer.routine.getByReference({ org: parsed.org, slug: parsed.slug });
}

/**
 * Resolve `ref` (an `rtn_…` or `sch_…` id, `org/slug`, or bare slug
 * against `org`) and fire it once, immediately.
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
export async function fireRoutine(stigmer: Stigmer, ref: string, org: string): Promise<CommandResult> {
  const before = await loadRoutine(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Routine '${ref}' has no id — cannot fire`);
  }

  const fired = await stigmer.routine.fire(create(FireRoutineInputSchema, { id }));
  const routine = fired.routine ?? before;
  const slug = routine.metadata?.slug ?? "";
  const name = routine.metadata?.name || slug;

  if (fired.outcome === RoutineFireOutcome.STARTED) {
    const result = CommandResult.success(`Routine '${name}' fired — run started`);
    const section = result.addSection();
    section.field("Run", fired.runId);
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
  result.hint("The fire is recorded in the routine's fire history; fix the cause and fire it again.");
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
