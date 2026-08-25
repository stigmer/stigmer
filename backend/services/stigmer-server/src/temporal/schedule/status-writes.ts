/**
 * The clock's status-write helpers — port the ensureStatus/bumpStatusAudit
 * pair of pkg/domain/schedule/temporal/syncer.go.
 *
 * bumpStatusAudit is DELIBERATELY narrower than the shared
 * setAuditFieldsForUpdate: Go's clock stamps only status-audit
 * updated_at + event ("the same two leaves every cloud runtime patch
 * bumps") and never an actor — the clock is the platform, not an operator.
 * Controller-side status writes (trigger's last_fire_at stamp, resume's
 * clear) use the FULL shared helper instead, exactly as Go splits
 * steps.SetAuditFieldsForUpdate from the clock's bump. Two flavors, two
 * writers, both wire-visible — keep them distinct.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import type { ScheduleStatus } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

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

/**
 * Stamps the status-audit trail for a runtime write — updated_at + event
 * "updated", nothing else (Go bumpStatusAudit; see the module header for
 * why this is not setAuditFieldsForUpdate).
 */
export function bumpStatusAudit(status: ScheduleStatus): void {
  if (status.audit === undefined) {
    status.audit = create(ApiResourceAuditSchema);
  }
  if (status.audit.statusAudit === undefined) {
    status.audit.statusAudit = create(ApiResourceAuditInfoSchema);
  }
  status.audit.statusAudit.updatedAt = timestampNow();
  status.audit.statusAudit.event = "updated";
}
