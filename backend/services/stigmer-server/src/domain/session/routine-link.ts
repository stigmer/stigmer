/**
 * A conversation a routine's fire started records its routine. The
 * routine run starter puts the routine on the identity it propagates to the
 * run create in-process (`CallerIdentity.routineId`), and the run create
 * hands that identity to the session it creates; this step, after the
 * create has cleared any status a client sent, writes it as
 * `status.routine_id`. Updates keep the stored status whole, so the field
 * is the server's alone.
 *
 * The session kind's parent declaration reads the field
 * (ParentRelationConfig.status_field), so the `session#routine` link that
 * shows the run to the routine's owner, Participants and Viewers is
 * derived from a fact no client can write: a wire request never carries
 * the routine (the chassis strips the propagation header and no verifier
 * sets it), and the step reads it only from a request the server composed.
 *
 * Proven by __tests__/routine-link.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";

import { isServerComposedRequest } from "../../extensions/identity.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";

export function newStampSessionRoutineStep(): PipelineStep<typeof SessionSchema> {
  return {
    name: "StampSessionRoutine",
    execute(ctx: RequestContext<typeof SessionSchema>): void {
      const caller = ctx.callerIdentity;
      const routineId = caller.routineId ?? "";
      if (routineId === "" || !isServerComposedRequest(caller)) {
        return;
      }
      (ctx.newState.status ??= create(SessionStatusSchema)).routineId = routineId;
    },
  };
}
