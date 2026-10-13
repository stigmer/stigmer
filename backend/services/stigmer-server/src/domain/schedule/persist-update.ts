/**
 * The update pipeline's persist step — ports persistScheduleUpdateStep of
 * pkg/domain/schedule/controller/update.go.
 *
 * Persists what the request path owns (apiVersion/kind/metadata/spec, the
 * audit bump BuildUpdateState stamped, and who attached each vault the
 * spec names, the VaultAttachments step's record, which a fire with no
 * person asks `can_use` of) over the status and slug of the row the chain
 * read, by compare-and-swap on that row. NOT a plain save: schedule status
 * has a concurrent writer (the tick), and a save of the load-time snapshot
 * could silently revert a fire record, a streak write, or a PAUSE —
 * breaking the "resume is the one clearing path" pin. A tick or a rename
 * that lands between the read and the write makes the swap lose, and the
 * chain runs again from a fresh read (pipeline/guarded-write.ts).
 *
 * A row deleted since the read loses the swap too, and the next attempt's
 * read answers NOT_FOUND: the delete won, honestly.
 */
import type { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { swapOntoLoadedRow } from "../../pipeline/steps/persist.js";
import type { Store } from "../../store/interface.js";

export function newPersistScheduleUpdateStep(
  store: Store,
): PipelineStep<typeof ScheduleSchema> {
  return {
    name: "PersistScheduleUpdate",
    async execute(ctx: RequestContext<typeof ScheduleSchema>): Promise<void> {
      await swapOntoLoadedRow(store, ctx);
    },
  };
}
