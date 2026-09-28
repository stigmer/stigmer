/**
 * The clock's status-write helper — ports ensureStatus of
 * pkg/domain/schedule/temporal/syncer.go.
 *
 * The clock's audit stamp is the shared `bumpStatusAudit`
 * (pipeline/steps/defaults.ts): status-audit updated_at + event only, never
 * an actor — the clock is the platform, not an operator. Controller-side
 * status writes (trigger's last_fire_at stamp, resume's clear) use the FULL
 * setAuditFieldsForUpdate instead, exactly as Go splits
 * steps.SetAuditFieldsForUpdate from the clock's bump.
 */
import { create } from "@bufbuild/protobuf";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import type { ScheduleStatus } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";

/**
 * Returns the schedule's status, materializing the nested message a fresh
 * row may lack (Go ensureStatus).
 */
export function ensureStatus(schedule: Schedule): ScheduleStatus {
  if (schedule.status === undefined) {
    schedule.status = create(ScheduleStatusSchema);
  }
  return schedule.status;
}
