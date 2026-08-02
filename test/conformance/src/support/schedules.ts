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
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ConformanceClients } from "../harness/clients";
import { pollUntil, type PollCoreOptions } from "./execution-poll";

export const SCHEDULE_API_VERSION = "agentic.stigmer.ai/v1";
export const SCHEDULE_KIND = "Schedule";

// ─── The DD-014 D-B trigger refusal matrix (contract copy) ─────────────────

// Refusing a disabled schedule: honoring the trigger would need a "manual"
// marker the tick cannot receive, so the fire would otherwise "succeed"
// while the tick's revalidation silently no-ops it.
export const TRIGGER_DISABLED_MESSAGE =
  "schedule is disabled (spec.enabled=false) — enable it before triggering";

// Refusing a platform-paused schedule, naming the reason — resume stays the
// one clearing path (DD-013 D-D).
export function triggerPausedMessage(pausedReason: string): string {
  return `schedule is paused by the platform (${pausedReason}) — resume it before triggering`;
}

// ─── The auto-pause teaching copy (contract copy, DD-013/DD-014) ───────────

// What the platform writes into status.paused_reason at the streak crossing.
export function pausedReasonCopy(threshold: number, lastFailure: string): string {
  return `Paused after ${threshold} consecutive failed runs. Last failure: ${lastFailure}`;
}

// The deterministic start-failure copy for a dangling agent reference — the
// suite's no-LLM failure mechanism: delete the target agent and every fire
// fails with exactly this reason before any execution is created.
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

// ─── Firing observability ──────────────────────────────────────────────────

// Polls the schedule until `predicate` holds — the poll-don't-sleep rhythm.
// Firing is asynchronous by contract (the trigger RPC answers before the
// fire records), so every firing assertion goes through here.
export async function pollScheduleUntil(
  clients: ConformanceClients,
  scheduleId: string,
  describe: string,
  predicate: (schedule: Schedule) => boolean,
  opts: PollCoreOptions = {},
): Promise<Schedule> {
  return pollUntil(
    () => clients.scheduleQuery.get({ value: scheduleId }),
    predicate,
    (last, timeoutMs) =>
      `schedule ${scheduleId} did not reach "${describe}" within ${timeoutMs}ms; ` +
      `last status: last_fire_at=${last?.status?.lastFireAt !== undefined ? "set" : "unset"}, ` +
      `consecutive_failures=${last?.status?.consecutiveFailures ?? 0}, ` +
      `paused_reason=${JSON.stringify(last?.status?.pausedReason ?? "")}`,
    opts,
  );
}
