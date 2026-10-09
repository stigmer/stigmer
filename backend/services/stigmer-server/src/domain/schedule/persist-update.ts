/**
 * The update pipeline's persist step — ports persistScheduleUpdateStep of
 * pkg/domain/schedule/controller/update.go.
 *
 * Persists an update as a graft of exactly what the request path owns —
 * apiVersion/kind/metadata/spec, the audit bump BuildUpdateState stamped,
 * and who attached each vault the spec names (the VaultAttachments step's
 * record, which a fire with no person asks `can_use` of) — onto the LIVE
 * row, inside one store.updateResource closure.
 * NOT the generic Persist step: schedule status has a concurrent writer
 * (the tick), and a full-row save of the load-time snapshot could silently
 * revert a fire record, a streak write, or a PAUSE — breaking the "resume
 * is the one clearing path" pin. The OSS twin of the cloud's targeted
 * metadata+spec+status.audit patch, shaped for a store whose unit of write
 * is the whole protobuf blob.
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
            // The status leaves the request path owns: its own audit bump
            // and the vault attachers it judged against this spec. Every
            // other status leaf stays exactly as the concurrent runtime
            // last wrote it.
            const status = newState.status;
            if (status !== undefined) {
              row.status ??= create(ScheduleStatusSchema);
              if (status.audit !== undefined) {
                row.status.audit = status.audit;
              }
              row.status.vaultAttachers = status.vaultAttachers;
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
