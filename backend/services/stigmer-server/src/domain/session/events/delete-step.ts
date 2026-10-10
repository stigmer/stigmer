/**
 * DeleteSessionEvents: a session's delete chain and its purge remove the
 * session's whole event log, before the session's row, so a retried delete
 * still finds the session and finishes the job. The store takes the
 * session's lock for it, the lock every writer of the log takes.
 *
 * A run created into the session while it is being deleted is today's
 * orphaned-run race, not a new one; the organization purge's final sweep
 * removes any events it leaves (Store.sessionEvents.deleteByOrg).
 *
 * Proven by __tests__/delete-step.test.ts and the session conformance
 * suite's delete arms.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { internalError } from "../../../pipeline/errors.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import type { RequestContext } from "../../../pipeline/request-context.js";
import { requireResourceId } from "../../../pipeline/steps/delete.js";
import type { Store } from "../../../store/interface.js";

export function newDeleteSessionEventsStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "DeleteSessionEvents",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const sessionId = requireResourceId(ctx);
      try {
        await store.sessionEvents.deleteBySession(sessionId);
      } catch (error) {
        throw internalError(error, "failed to delete the session's events");
      }
    },
  };
}
