/**
 * The agent execution's purge (domain/organization/purge/kind-purge.ts):
 * every execution of an organization being deleted, removed with its
 * delete chain's cleanup (controller.ts `deleteExecution`: the row, its
 * access, its search entry), read through the execution list index.
 *
 * One removal the chain does not make: the blobs of the execution's
 * attachments, by their `storage_key`. An attachment is uploaded under a
 * key minted per upload (`attachments/<ulid>/<file>`, artifacts.ts), so no
 * other execution names it; deleting an execution through its RPC leaves
 * the blob behind, and a purge must not. The key in `spec.attachments` is
 * the one the creator sent, checked at create only for presence, so it may
 * name any object in the blob store; only a key of the shape the upload
 * mints (`isMintedAttachmentKey`) is deleted, and any other is left where
 * it is. Removed before the row, which is
 * how a retry finds them: a fault fails the batch with the row in place,
 * and the retry deletes what is left (a missing blob is no fault). Core
 * quiesce has already terminated the run.
 */
import type { MessageShape } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { agentExecutionListIndex } from "./list-index.js";

import { isMintedAttachmentKey } from "./artifacts.js";

type DeleteInput = typeof AgentExecutionCommandController.method.delete.input;

export interface AgentExecutionPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The blob store the attachments were uploaded to. */
  readonly artifactStorage: Pick<ArtifactStorage, "delete">;
}

export function newAgentExecutionPurge(
  deps: AgentExecutionPurgeDeps,
): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent_execution,
    schema: AgentExecutionSchema,
    input: AgentExecutionCommandController.method.delete.input,
    listIndex: agentExecutionListIndex,
    steps: [
      newDeleteAttachmentBlobsStep(deps.artifactStorage),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}

/** DeleteAttachmentBlobs — every attachment's blob, by its storage key; a missing blob is no fault. */
function newDeleteAttachmentBlobsStep(
  storage: Pick<ArtifactStorage, "delete">,
): PipelineStep<DeleteInput> {
  return {
    name: "DeleteAttachmentBlobs",
    async execute(ctx: RequestContext<DeleteInput>): Promise<void> {
      const execution = ctx.get(EXISTING_RESOURCE_KEY) as
        | MessageShape<typeof AgentExecutionSchema>
        | undefined;
      for (const attachment of execution?.spec?.attachments ?? []) {
        // A key the creator sent may name any object in the blob store;
        // only one uploadAttachment minted is the execution's to delete.
        if (isMintedAttachmentKey(attachment.storageKey)) {
          await storage.delete(attachment.storageKey);
        }
      }
    },
  };
}
