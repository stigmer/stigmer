// `schedule resume` dispatch: clear a platform auto-pause from a schedule
// and report what was cleared.
//
// "Paused" is the platform's latch (status.paused_reason, written after
// repeated failed runs), distinct from "disabled", the owner's switch
// (spec.enabled) — two words, two levers (see docs/vocabulary.md). The
// resume RPC is deliberately the only path that clears the latch: applying
// a manifest preserves status verbatim, so no declarative apply can
// silently un-pause a failing schedule.
//
// The pre-state read exists for honest messaging only: the RPC is
// idempotent and its response always shows a cleared latch, so "resumed"
// versus "was not paused" can only be told apart by looking first. The
// resume call is made either way — on the no-op path it doubles as a
// harmless re-arm of the schedule's clock.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { parseReference } from "./reference.js";
import { requireOrganization } from "../client/single-org.js";

/** The schedule kind's canonical id prefix (proto kind_meta). */
const ROUTINE_ID_PREFIX = "sch";

/**
 * Resolve `ref` (a `sch_…` id, `org/slug`, or bare slug against `org`),
 * clear its platform pause, and describe the outcome.
 */
export async function resumeRoutine(stigmer: Stigmer, ref: string, org: string): Promise<CommandResult> {
  const before = await loadRoutine(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Schedule '${ref}' has no id — cannot resume`);
  }

  const wasPausedReason = before.status?.pausedReason ?? "";
  const wasFailures = before.status?.consecutiveFailures ?? 0;

  const resumed = await stigmer.routine.resume(id);

  return describeOutcome(resumed, wasPausedReason, wasFailures);
}

async function loadRoutine(stigmer: Stigmer, ref: string, org: string): Promise<Routine> {
  const parsed = parseReference(ref, org, ROUTINE_ID_PREFIX);
  if (parsed.kind === "id") {
    return stigmer.routine.get(parsed.id);
  }
  await requireOrganization(stigmer, parsed.org, [
    "stigmer config context set --org <org>",
    "stigmer schedule resume --org <org> ...",
  ]);
  return stigmer.routine.getByReference({ org: parsed.org, slug: parsed.slug });
}

/**
 * Resolve `ref` (a `sch_…` id, `org/slug`, or bare slug against `org`) and
 * fire it once, immediately.
 *
 * The fire is SYNCHRONOUS: the RPC runs the full run create pipeline
 * and the result names the run's real outcome — the created run's
 * id, or the refusing gate's copy verbatim. A refused run renders as an
 * error result (non-zero exit) so a scripted test fire fails honestly,
 * but the trigger itself succeeded: the fire is recorded in the
 * schedule's run history either way. A disabled schedule is refused by
 * the server with teaching copy; the CLI relays the server's message
 * verbatim (never pattern-match refusal text).
 */
export async function fireRoutine(stigmer: Stigmer, ref: string, org: string): Promise<CommandResult> {
  const before = await loadRoutine(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Schedule '${ref}' has no id — cannot trigger`);
  }

  const triggered = await stigmer.routine.fire(id);
  const routine = triggered.routine ?? before;
  const slug = routine.metadata?.slug ?? "";
  const name = routine.metadata?.name || slug;

  if (triggered.outcome === RoutineFireOutcome.STARTED) {
    const result = CommandResult.success(`Schedule '${name}' fired — run started`);
    const section = result.addSection();
    section.field("Run", triggered.runId);
    section.field("Watch it", `stigmer get run ${triggered.runId}`);
    if (routine.status?.nextFireAt !== undefined) {
      section.field("Next cron fire", timestampDate(routine.status.nextFireAt).toISOString());
    }
    return result;
  }

  // The run was refused deterministically (a launch gate said no, or the
  // target agent is gone). The fire happened and is recorded in run
  // history; the refusing gate's copy relays verbatim.
  const what = triggered.outcome === RoutineFireOutcome.TARGET_MISSING
    ? "the target agent was not found"
    : "a launch gate refused the run";
  const result = CommandResult.error(`Schedule '${name}' fired, but ${what}`);
  const section = result.addSection();
  section.field("Reason", triggered.refusalReason);
  result.hint("The fire is recorded in the schedule's run history; fix the cause and trigger again.");
  return result;
}

function describeOutcome(routine: Routine, wasPausedReason: string, wasFailures: number): CommandResult {
  const slug = routine.metadata?.slug ?? "";
  const name = routine.metadata?.name || slug;
  const wasPaused = wasPausedReason !== "" || wasFailures > 0;

  const result = CommandResult.success(
    wasPaused ? `Schedule '${name}' resumed` : `Schedule '${name}' was not paused — nothing to clear`,
  );

  if (wasPaused) {
    const section = result.addSection("Cleared");
    if (wasPausedReason !== "") section.field("Pause reason", wasPausedReason);
    if (wasFailures > 0) section.field("Consecutive failures", String(wasFailures));
  }

  if (routine.spec?.enabled !== true) {
    result.hint("This schedule is disabled (enabled: false) — it will not fire until you enable it:");
    result.hint(`  edit the manifest to 'enabled: true' and run: stigmer apply -f <file>`);
  } else if (routine.status?.nextFireAt !== undefined) {
    result.addSection().field("Next fire", timestampDate(routine.status.nextFireAt).toISOString());
  }

  return result;
}
