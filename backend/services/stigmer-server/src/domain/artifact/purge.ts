/**
 * The artifact's purge (domain/organization/purge/kind-purge.ts): every
 * artifact of an organization being deleted, its row removed for good and
 * its blob with it unless another artifact still names the blob.
 *
 * Why not the delete chain's steps. An artifact's delete is a soft delete
 * (controller.ts `deleteArtifact`: the row stays, `status.storage_state`
 * becomes deleted, the blob stays for the GC job), which a purge cannot
 * leave behind. So the purge deletes the row and its access, then the
 * blob.
 *
 * Why the blob check. Blobs are content-addressed: the key is the
 * content's SHA-256 (`status.content_hash`), so two artifacts with the
 * same bytes, in any organizations, share one blob. The blob goes only
 * when no remaining artifact row names its hash, answered through the
 * artifact list index's `blob` key (list-index.ts). Rows are removed one
 * at a time, so the last of an organization's artifacts sharing a blob
 * removes it. A create of the same bytes elsewhere that uploads between
 * the check and the delete and stores its row after it would lose its blob
 * (a download answers that the blob is gone); the window is one store
 * round trip, and the create's upload is the cue to re-upload.
 */
import type { MessageShape } from "@bufbuild/protobuf";

import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { artifactListIndex } from "./list-index.js";

type DeleteInput = typeof ArtifactCommandController.method.delete.input;

export interface ArtifactPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The content-addressed blob store artifacts upload to. */
  readonly artifactStorage: Pick<ArtifactStorage, "delete">;
}

export function newArtifactPurge(deps: ArtifactPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.artifact,
    schema: ArtifactSchema,
    input: ArtifactCommandController.method.delete.input,
    listIndex: artifactListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteUnsharedBlobStep(deps.store, deps.artifactStorage),
    ],
  });
}

/** DeleteUnsharedBlob — after the row: the blob, when no other artifact row names its hash. */
function newDeleteUnsharedBlobStep(
  store: Pick<Store, "queryResources">,
  storage: Pick<ArtifactStorage, "delete">,
): PipelineStep<DeleteInput> {
  return {
    name: "DeleteUnsharedBlob",
    async execute(ctx: RequestContext<DeleteInput>): Promise<void> {
      const artifact = ctx.get(EXISTING_RESOURCE_KEY) as
        | MessageShape<typeof ArtifactSchema>
        | undefined;
      const hash = artifact?.status?.contentHash ?? "";
      if (hash === "") {
        return;
      }
      const id = artifact?.metadata?.id ?? "";
      const holders = await store.queryResources(artifactListIndex, {
        anyKey: [{ name: "blob", value: hash }],
        limit: 2,
      });
      if (holders.some((holder) => holder.id !== id)) {
        return;
      }
      await storage.delete(hash);
    },
  };
}
