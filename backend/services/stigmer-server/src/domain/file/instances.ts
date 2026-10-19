/**
 * A conversation's own copy of a File. A File a conversation names (in its
 * resources, or with a message in RunSpec.file_ids) that is not already the
 * conversation's becomes a new File of that conversation over the same
 * bytes, and the conversation names the copy, as Managed Agents does with a
 * session's file resources. The original keeps its own access, and deleting
 * it later leaves the copy; the bytes go only with the last File that names
 * them (store/file-blobs.ts).
 *
 * Who may name a File: whoever may view it, in the conversation's
 * organization. A File of another organization is refused before access is
 * asked, so the answer says nothing about another organization's Files.
 * The copy is owned by the writer, links the conversation, and starts
 * private, as an upload into the conversation does.
 *
 * One write makes each copy once. A guarded write runs its chain again
 * after a lost swap, so the copies live in this object, which the write
 * holds across its attempts; a write that fails for good discards them.
 *
 * Proven by __tests__/instances.test.ts and the session and run suites.
 */
import { clone, create } from "@bufbuild/protobuf";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { getIdPrefix } from "../../pipeline/apiresource-meta.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import {
  cleanUpDeletedResource,
  resolveResourceCreatedEvent,
} from "../../pipeline/steps/authorization-tuples.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { generateId, setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import { FileBlobUnavailableError } from "../../store/file-blobs.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { FileBlobs } from "./blobs.js";

/** The refusal when the writer may not view a File it names. */
export function mayNotNameFileMessage(fileId: string): string {
  return `unauthorized to give file ${fileId} to this conversation`;
}

export interface FileInstanceDeps {
  readonly store: Store;
  readonly blobs: FileBlobs;
  readonly authorizer: Authorizer;
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly logger: Logger;
}

/** Where a named File is going: the conversation and its organization. */
export interface FileTarget {
  readonly org: string;
  readonly sessionId: string;
}

export interface FileInstances {
  /**
   * The conversation's own File for `fileId`: the File itself when it is
   * already the conversation's, else the copy this write made of it (made
   * on the first ask).
   */
  resolve(fileId: string, target: FileTarget, caller: CallerIdentity): Promise<File>;
  /** Removes every copy this write made: its row, its ref, its access. */
  discard(caller: CallerIdentity): Promise<void>;
  /** The copies this write made, by the original's id. */
  readonly made: ReadonlyMap<string, File>;
}

export function newFileInstances(deps: FileInstanceDeps): FileInstances {
  const made = new Map<string, File>();

  const load = async (fileId: string): Promise<File> => {
    try {
      return await deps.store.getResource(ApiResourceKind.file, fileId, FileSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw notFoundError("file", fileId);
      }
      throw internalError(error, "failed to load file");
    }
  };

  const copy = async (original: File, target: FileTarget, caller: CallerIdentity): Promise<File> => {
    const originalId = original.metadata?.id ?? "";
    let blobKey: string | undefined;
    try {
      blobKey = await deps.store.files.blobKeyOf(originalId);
    } catch (error) {
      throw internalError(error, "failed to read the file's storage");
    }
    if (blobKey === undefined) {
      throw failedPreconditionError(`file ${originalId} was deleted`);
    }
    const instance = create(FileSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "File",
      metadata: {
        id: generateId(getIdPrefix(ApiResourceKind.file)),
        org: target.org,
        name: original.metadata?.name ?? "",
        visibility: ApiResourceVisibility.visibility_private,
      },
      spec: clone(FileSpecSchema, original.spec ?? create(FileSpecSchema)),
      status: { sizeBytes: original.status?.sizeBytes ?? 0n, sessionId: target.sessionId },
    });
    setAuditFieldsForCreate(FileSchema, instance, caller);
    const id = instance.metadata?.id ?? "";
    try {
      await deps.store.files.insert(
        ApiResourceKind.file,
        id,
        FileSchema,
        instance,
        { blobKey, org: target.org, sizeBytes: Number(original.status?.sizeBytes ?? 0n) },
        Math.floor(Date.now() / 1000),
      );
    } catch (error) {
      if (error instanceof FileBlobUnavailableError) {
        throw failedPreconditionError(`file ${originalId} was deleted`);
      }
      throw internalError(error, "failed to save file");
    }
    const event =
      deps.lifecycle === undefined
        ? undefined
        : resolveResourceCreatedEvent(ApiResourceKind.file, instance, caller, deps.logger);
    if (deps.lifecycle !== undefined && event !== undefined) {
      try {
        await deps.lifecycle.onResourceCreated(event);
      } catch (error) {
        await deps.blobs.removeFile(id);
        throw internalError(error, "failed to create authorization tuples");
      }
    }
    return instance;
  };

  return {
    made,

    async resolve(fileId, target, caller) {
      const cached = made.get(fileId);
      if (cached !== undefined) {
        return cached;
      }
      const file = await load(fileId);
      if ((file.metadata?.org ?? "") !== target.org) {
        throw failedPreconditionError(`file ${fileId} belongs to another organization`);
      }
      if ((file.status?.sessionId ?? "") === target.sessionId && target.sessionId !== "") {
        return file;
      }
      await authorizeResolvedResource(
        deps.authorizer,
        caller,
        { permission: IamPermission.can_view, resourceKind: ApiResourceKind.file, resourceId: fileId },
        mayNotNameFileMessage(fileId),
      );
      const instance = await copy(file, target, caller);
      made.set(fileId, instance);
      return instance;
    },

    async discard(caller) {
      for (const instance of made.values()) {
        const id = instance.metadata?.id ?? "";
        await deps.blobs.removeFile(id);
        await cleanUpDeletedResource(deps.lifecycle, deps.logger, {
          kind: ApiResourceKind.file,
          resourceId: id,
          orgId: instance.metadata?.org ?? "",
          caller,
        });
      }
      made.clear();
    },
  };
}

/** Removes a failed write's copies; a fault here is logged, never raised over the write's own. */
export async function discardQuietly(instances: FileInstances, caller: CallerIdentity, logger: Logger): Promise<void> {
  try {
    await instances.discard(caller);
  } catch (error) {
    logger.warn("failed to remove the File copies of a failed write", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
