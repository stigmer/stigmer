// `schedule resume` dispatch: clear a platform auto-pause from a schedule
// and report what was cleared.
//
// "Paused" is the platform's latch (status.paused_reason, written after
// repeated failed runs), distinct from "disabled", the owner's switch
// (spec.enabled) — two words, two levers (see docs/vocabulary.md). The
// resume RPC is deliberately the only path that clears the latch: applying
// a manifest preserves status verbatim, so no declarative workflow can
// silently un-pause a failing schedule.
//
// The pre-state read exists for honest messaging only: the RPC is
// idempotent and its response always shows a cleared latch, so "resumed"
// versus "was not paused" can only be told apart by looking first. The
// resume call is made either way — on the no-op path it doubles as a
// harmless re-arm of the schedule's clock.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { parseReference } from "./reference.js";

/** The schedule kind's canonical id prefix (proto kind_meta). */
const SCHEDULE_ID_PREFIX = "sch";

/**
 * Resolve `ref` (a `sch_…` id, `org/slug`, or bare slug against `org`),
 * clear its platform pause, and describe the outcome.
 */
export async function resumeSchedule(stigmer: Stigmer, ref: string, org: string): Promise<CommandResult> {
  const before = await loadSchedule(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Schedule '${ref}' has no id — cannot resume`);
  }

  const wasPausedReason = before.status?.pausedReason ?? "";
  const wasFailures = before.status?.consecutiveFailures ?? 0;

  const resumed = await stigmer.schedule.resume(id);

  return describeOutcome(resumed, wasPausedReason, wasFailures);
}

async function loadSchedule(stigmer: Stigmer, ref: string, org: string): Promise<Schedule> {
  const parsed = parseReference(ref, org, SCHEDULE_ID_PREFIX);
  if (parsed.kind === "id") {
    return stigmer.schedule.get(parsed.id);
  }
  if (parsed.org === "") {
    throw new UsageError(
      "organization not set\n\nSet it with:\n  stigmer config context set --org <org>\n  stigmer schedule resume --org <org> ...",
    );
  }
  return stigmer.schedule.getByReference({ org: parsed.org, slug: parsed.slug });
}

/**
 * Resolve `ref` (a `sch_…` id, `org/slug`, or bare slug against `org`) and
 * fire it once, immediately (project DD-014).
 *
 * The fire is asynchronous: the RPC answers with the schedule, and the run
 * lands on status (last_fire_at / last_execution_id) as it starts — the
 * same observability contract cron fires have. Disabled and platform-paused
 * schedules are refused by the server with teaching copy; the CLI relays
 * the server's message verbatim (never pattern-match refusal text).
 */
export async function triggerSchedule(stigmer: Stigmer, ref: string, org: string): Promise<CommandResult> {
  const before = await loadSchedule(stigmer, ref, org);
  const id = before.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`Schedule '${ref}' has no id — cannot trigger`);
  }

  const triggered = await stigmer.schedule.trigger(id);

  const slug = triggered.metadata?.slug ?? "";
  const name = triggered.metadata?.name || slug;
  const result = CommandResult.success(`Schedule '${name}' triggered — a run is starting`);

  const section = result.addSection();
  const orgSlug = triggered.metadata?.org ? `${triggered.metadata.org}/${slug}` : slug;
  section.field("Watch it land", `stigmer get schedule ${orgSlug} (status.last_execution_id)`);
  if (triggered.status?.nextFireAt !== undefined) {
    section.field("Next cron fire", timestampDate(triggered.status.nextFireAt).toISOString());
  }

  return result;
}

function describeOutcome(schedule: Schedule, wasPausedReason: string, wasFailures: number): CommandResult {
  const slug = schedule.metadata?.slug ?? "";
  const name = schedule.metadata?.name || slug;
  const wasPaused = wasPausedReason !== "" || wasFailures > 0;

  const result = CommandResult.success(
    wasPaused ? `Schedule '${name}' resumed` : `Schedule '${name}' was not paused — nothing to clear`,
  );

  if (wasPaused) {
    const section = result.addSection("Cleared");
    if (wasPausedReason !== "") section.field("Pause reason", wasPausedReason);
    if (wasFailures > 0) section.field("Consecutive failures", String(wasFailures));
  }

  if (schedule.spec?.enabled !== true) {
    result.hint("This schedule is disabled (enabled: false) — it will not fire until you enable it:");
    result.hint(`  edit the manifest to 'enabled: true' and run: stigmer apply -f <file>`);
  } else if (schedule.status?.nextFireAt !== undefined) {
    result.addSection().field("Next fire", timestampDate(schedule.status.nextFireAt).toISOString());
  }

  return result;
}
