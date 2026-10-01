/**
 * An execution belongs to its session, and to that session's organization:
 * the two steps that hold the binding on every write path.
 *
 * ValidateSessionOrganization (create, stigmer/stigmer#1580). The run gate
 * admits a turn by the session (`can_create_execution_in`), never by
 * `metadata.org`, and create is `is_skip_authorization`; without this step
 * a caller who may add turns to a session could file one under any
 * organization string it sends, and the execution's organization tuple and
 * its billing would follow that string rather than the conversation.
 *
 *   - no `session_id`: nothing to judge. The auto-created session is owned
 *     under the execution's org by the session create it runs, which
 *     authorizes that org itself.
 *   - `metadata.org` empty: it is the session's. A client continuing a
 *     session may leave it out, and the edition lanes that stamp the org
 *     from a token in the pre-side-effect gate slot (a channel, a guest)
 *     then compare their token's org with the session's.
 *   - `metadata.org` equal to the session's: passes.
 *   - a session with no organization: not judged. There is no organization
 *     for the turn to belong to, and refusing would leave such a session
 *     unreplyable; the session create chain gives every session one.
 *   - differing: FailedPrecondition, the platform's same-organization
 *     refusal (a schedule and its agent, a channel and its agent), naming
 *     neither organization. The edition lanes (a guest, a channel, a
 *     schedule fire) pass the run gate unchecked and are admitted later, in
 *     the gate slot, so the caller refused here may be one who may not read
 *     the session at all. One signal remains for such a caller: holding a
 *     session's id, it can tell this refusal (a differing organization)
 *     from its lane gate's later answer (a matching one, or no session), so
 *     it can tell whether that id names a session, and confirm a guessed
 *     organization for it. Closing that would mean skipping the check for
 *     caller classes the server does not know, which trusts every future
 *     lane by default, so the check stays for every caller.
 *
 * Position: right after the run gate, so a caller the gate checked and
 * refused learns nothing about the session (ValidateThinkingMode's rule for
 * reading a stored session), and before the gate slot, so no edition gate,
 * the credit reservation included, ever sees a turn filed under another
 * organization. A dangling session id passes: the loading steps own that
 * refusal, with its own NotFound. A store fault is Internal, never a
 * reading of the session.
 *
 * ValidateSessionImmutability (update, stigmer/stigmer#1588). Update
 * replaces the spec in full, and without this step a caller who may edit an
 * execution could point it at another session, past the run gate, while
 * its `session` tuple kept naming the first. A `session_id` different from
 * the stored one is refused with FailedPrecondition, as a session refuses a
 * changed harness (ValidateHarnessImmutability), and that includes naming
 * a session for an execution stored without one: it would join a session
 * nobody admitted it to. An empty one, or an update with no spec at all,
 * keeps the stored session, so a replacement that leaves the field out
 * stays valid. It runs after BuildUpdateState, on the merged state,
 * because that is where the stored value can be carried over.
 */
import { create } from "@bufbuild/protobuf";

import type {
  AgentExecution,
  AgentExecutionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  sessionIdImmutableMessage,
  sessionOrganizationMismatchMessage,
} from "./constants.js";

export function newValidateSessionOrganizationStep(
  store: Store,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "ValidateSessionOrganization",
    async execute(ctx) {
      const execution = ctx.newState;
      const sessionId = execution.spec?.sessionId ?? "";
      if (sessionId === "") {
        return;
      }

      const session = await loadSession(store, sessionId);
      if (session === undefined) {
        return;
      }
      const sessionOrg = session.metadata?.org ?? "";
      if (sessionOrg === "") {
        return;
      }
      const requestOrg = execution.metadata?.org ?? "";

      if (requestOrg === "") {
        execution.metadata ??= create(ApiResourceMetadataSchema);
        execution.metadata.org = sessionOrg;
        return;
      }
      if (requestOrg !== sessionOrg) {
        throw failedPreconditionError(
          sessionOrganizationMismatchMessage(sessionId),
        );
      }
    },
  };
}

export function newValidateSessionImmutabilityStep(): PipelineStep<
  typeof AgentExecutionSchema
> {
  return {
    name: "ValidateSessionImmutability",
    execute(ctx) {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | AgentExecution
        | undefined;
      const storedSessionId = existing?.spec?.sessionId ?? "";
      // An update that leaves the spec out replaces it with nothing; the
      // session is carried over all the same, as for an empty session_id.
      const merged = ctx.newState;
      merged.spec ??= create(AgentExecutionSpecSchema);
      if (merged.spec.sessionId === "") {
        merged.spec.sessionId = storedSessionId;
        return;
      }
      if (merged.spec.sessionId !== storedSessionId) {
        throw failedPreconditionError(
          sessionIdImmutableMessage(storedSessionId),
        );
      }
    },
  };
}

/** The stored session, or undefined when the id names none. */
async function loadSession(
  store: Store,
  sessionId: string,
): Promise<Session | undefined> {
  try {
    return await store.getResource(
      ApiResourceKind.session,
      sessionId,
      SessionSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(
      error,
      "failed to load session for organization validation",
    );
  }
}
