// Canonical valid Schedule fixtures + firing observability for the
// conformance suite.
// Domain: conformance support.
//
// A Schedule is cron + IANA timezone + an agent target; its firing
// observations (last_fire_at, last_execution_id, consecutive_failures,
// paused_reason) are platform-written status the suites can only observe,
// never seed — which is exactly what makes them conformance-assertable:
// every value here was produced by the edition under test.
//
// The exported copy constants are CROSS-EDITION CONTRACT STRINGS: the Java
// handlers (stigmer-cloud) and the Go controller (stigmer) each pin them in
// their own unit tests, and this suite asserts them over the wire on both.
// A change to any of them is a contract change, not a copy edit.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const SCHEDULE_API_VERSION = "agentic.stigmer.ai/v1";
export const SCHEDULE_KIND = "Schedule";

// ─── The trigger refusal copy (contract copy, DD-017 D-5) ──────────────────

// Refusing a disabled schedule — the ONE remaining trigger refusal (DD-017
// D-5 narrowed DD-014 D-B's matrix: paused schedules now fire, and manual
// fires run synchronously through the create pipeline rather than the
// artifact). The refusal survives because ScheduleBlueprintAccess requires
// spec.enabled at the create gate AND the mid-run sandbox read predicate;
// consoles offer "Enable & run now" as the remedy.
export const TRIGGER_DISABLED_MESSAGE =
  "schedule is disabled (spec.enabled=false) — enable it before triggering";

// NOTE: the DD-014-era paused-trigger refusal and the auto-pause crossing
// are no longer black-box assertable here — the streak accumulates only
// from CRON fires (DD-017 D-5: manual fires never feed it), and a real
// cron arc is infeasible under the cloud conformance environment's
// production interval floor. The pause machinery keeps tick-level coverage
// in both editions, and the pause copy stays byte-pinned in their unit
// tests.

// The deterministic start-failure copy for a dangling agent reference — the
// suite's no-LLM failure mechanism: delete the target agent and every fire
// fails with exactly this reason before any execution is created. Pinned
// byte-identical in the Java tick activities and the Go run starter.
export function targetMissingReason(org: string, agentSlug: string): string {
  return `target agent ${org}/${agentSlug} not found`;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

export interface ScheduleOptions {
  // 5-field cron; defaults to a quiet daily fire so a real cron tick can
  // never race the suite's explicit triggers.
  cron?: string;
  timeZone?: string;
  enabled?: boolean;
  message?: string;
}

// A valid Schedule referencing `agentSlug` in `org`. Org is set on both the
// metadata and the reference: the contract requires metadata.org to equal
// the referenced agent's org (the create-time consent bar).
export function makeSchedule(
  org: string,
  name: string,
  agentSlug: string,
  options: ScheduleOptions = {},
): MessageInitShape<typeof ScheduleSchema> {
  return {
    apiVersion: SCHEDULE_API_VERSION,
    kind: SCHEDULE_KIND,
    metadata: { name, org },
    spec: {
      cron: options.cron ?? "0 9 * * *",
      timeZone: options.timeZone ?? "Asia/Kolkata",
      enabled: options.enabled ?? true,
      target: {
        case: "agent",
        value: {
          agentRef: { kind: ApiResourceKind.agent, org, slug: agentSlug },
          message: options.message ?? "Run the scheduled conformance task.",
        },
      },
    },
  };
}

// The DD-014-era pollScheduleUntil helper is gone with the asynchronous
// trigger it served: the sync trigger answers with the fire's outcome in
// the result, so firing assertions read the response (or listRuns) rather
// than polling status.
