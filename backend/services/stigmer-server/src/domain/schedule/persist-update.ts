/**
 * The update pipeline's persist step — ports persistScheduleUpdateStep of
 * pkg/domain/schedule/controller/update.go.
 *
 * Persists an update as a graft of exactly what the request path owns —
 * apiVersion/kind/metadata/spec plus the audit bump BuildUpdateState
 * stamped — onto the LIVE row, inside one store.updateResource closure.
 * NOT the generic Persist step: schedule status has a concurrent writer
 * (the tick), and a full-row save of the load-time snapshot could silently
 * revert a fire record, a streak write, or a PAUSE — breaking the "resume
 * is the one clearing path" pin. The OSS twin of the cloud's targeted
 * metadata+spec+status.audit patch, shaped for a store whose unit of write
 * is the whole protobuf blob (DD-015 D-C).
 *
 * Unlike a save, the graft never resurrects a concurrently deleted row:
 * updateResource answers not-found, relayed as NOT_FOUND — the delete won,
 * honestly.
 */
import { create } from "@bufbuild/protobuf";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

export function newPersistScheduleUpdateStep(
  store: Store,
): PipelineStep<typeof ScheduleSchema> {
  return {
    name: "PersistScheduleUpdate",
    async execute(ctx: RequestContext<typeof ScheduleSchema>): Promise<void> {
      const newState = ctx.newState;
      const scheduleId = newState.metadata?.id ?? "";

      let live: Schedule;
      try {
        live = await store.updateResource(
          ApiResourceKind.schedule,
          scheduleId,
          ScheduleSchema,
          (row) => {
            row.apiVersion = newState.apiVersion;
            row.kind = newState.kind;
            row.metadata = newState.metadata;
            row.spec = newState.spec;
            // The one status subtree the request path owns: its own audit
            // bump. Every other status leaf stays exactly as the
            // concurrent runtime last wrote it.
            if (newState.status?.audit !== undefined) {
              if (row.status === undefined) {
                row.status = create(ScheduleStatusSchema);
              }
              row.status.audit = newState.status.audit;
            }
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Schedule", scheduleId);
        }
        throw internalError(error, "failed to persist schedule update");
      }

      // Answer with the persisted post-image: the new spec plus the LIVE
      // status — fresher than the load-time snapshot, and honest about
      // anything the runtime wrote mid-request.
      ctx.setNewState(live);
    },
  };
}
