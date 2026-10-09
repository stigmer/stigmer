/**
 * The session's purge (domain/organization/purge/kind-purge.ts): every
 * session of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteSession`: its executions, the row,
 * its access, its search entry), read through the session list index, and
 * without its refusal of a session with active executions: core quiesce
 * has terminated them. The executions themselves are purged first, by
 * their own purge (which also removes their attachments), so the cascade
 * here finds none in the usual order. The sandbox the handler tears down
 * after its chain went in core quiesce.
 */
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import type { SecretService } from "../../encryption/encryption.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import type { RunScoreCascade } from "../score/cascade.js";
import { sealedValuesOfSession } from "../vault/session-values.js";
import { sessionListIndex } from "./list-index.js";
import { newCascadeDeleteAgentExecutionsStep } from "./steps.js";

type DeleteInput = typeof SessionCommandController.method.delete.input;

export interface SessionPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** Destroys the backing state of the session's own sealed values. */
  readonly secretService: SecretService;
  /** Removes each cascaded run's scores before the run's row. */
  readonly runScores: RunScoreCascade;
}

export function newSessionPurge(deps: SessionPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.session,
    schema: SessionSchema,
    input: SessionCommandController.method.delete.input,
    listIndex: sessionListIndex,
    steps: [
      newCascadeDeleteAgentExecutionsStep(
        deps.store,
        deps.authorizationLifecycle,
        deps.logger,
        deps.runScores,
      ),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDestroySecretBackingStateStep<DeleteInput, typeof SessionSchema>(
        deps.secretService,
        deps.logger,
        sealedValuesOfSession,
      ),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
