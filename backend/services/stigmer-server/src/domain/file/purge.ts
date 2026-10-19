/**
 * The File's purge (domain/organization/purge/kind-purge.ts): every File of
 * an organization being deleted, removed with its delete chain's cleanup
 * (controller.ts `deleteFile`: its row, its ref, its bytes when no other
 * File shares them, its access), read through the File list index. Once no
 * File is left, the organization's remaining blobs go too, bytes before
 * rows: upload URLs never used and bytes a failed delete left for a sweep.
 * A purge stopped halfway converges when it runs again, because a blob's
 * row is how the next run finds its bytes.
 */
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type { KindPurge, KindPurgeDeps } from "../organization/purge/kind-purge.js";
import type { FileBlobs } from "./blobs.js";
import { fileListIndex } from "./list-index.js";

export interface FilePurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The File store's bytes and blob rows. */
  readonly fileBlobs: FileBlobs;
}

export function newFilePurge(deps: FilePurgeDeps): KindPurge {
  const files = newKindPurge(deps, {
    kind: ApiResourceKind.file,
    schema: FileSchema,
    input: FileCommandController.method.delete.input,
    listIndex: fileListIndex,
    steps: [
      newDeleteResourceStep(deps.store, (id) => deps.fileBlobs.removeFile(id)),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
  return {
    kind: ApiResourceKind.file,
    async purge(org, caller, limit) {
      const batch = await files.purge(org, caller, limit);
      if (batch.more) {
        return batch;
      }
      await deps.fileBlobs.purgeOrganization(org.id);
      return { more: false };
    },
    async holdsAny(org) {
      return (await files.holdsAny(org)) || (await deps.fileBlobs.holdsAny(org.id));
    },
  };
}
