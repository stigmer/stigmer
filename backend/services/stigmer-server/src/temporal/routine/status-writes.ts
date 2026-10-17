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

import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";
import type { RoutineStatus } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";

/**
 * Returns the routine's status, materializing the nested message a fresh
 * row may lack (Go ensureStatus).
 */
export function ensureStatus(routine: Routine): RoutineStatus {
  if (routine.status === undefined) {
    routine.status = create(RoutineStatusSchema);
  }
  return routine.status;
}
