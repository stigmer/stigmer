/**
 * The File chains' own steps and rules (controller.ts runs them).
 *
 * Who may upload. `upload` and `createUploadUrl` are skip-authorization in
 * the contract because the permission depends on the request: into a
 * conversation, whoever may send it a message (can_create_run_in on the
 * session), and the request's organization must be the conversation's;
 * otherwise whoever may start a conversation in the organization
 * (can_create_file). A credential bound to another organization uploads
 * nothing, before any byte moves. Minting an upload URL asks exactly what
 * consuming it will.
 *
 * What a File's update may change: its labels and tags. Its filename and
 * type are its upload's, and its name follows its filename, so the update
 * refuses those paths by name and keeps their stored values under a
 * broader path (`spec`, `*`): a File's bytes are immutable, and so is what
 * describes them.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { FileStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { OrganizationAdmission } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { RefusedUpdatePath } from "../../pipeline/steps/update-mask.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { routineListIndex } from "../routine/list-index.js";
import type { FileBlobs, NewBlob } from "./blobs.js";

/** The refusal when the caller may not upload into the conversation. */
export const UPLOAD_INTO_SESSION_DENIED = "unauthorized to upload a file into this session";

/** The refusal when the caller may not upload a File of their own. */
export const UPLOAD_IN_ORGANIZATION_DENIED = "unauthorized to upload a file in this organization";

/** The longest metadata.name holds; a longer filename is cut for the name alone. */
const MAX_NAME_LENGTH = 200;

/** A File's name: its filename, cut to what metadata.name holds. */
export function fileNameOf(filename: string): string {
  const characters = [...filename];
  return characters.length <= MAX_NAME_LENGTH
    ? filename
    : characters.slice(0, MAX_NAME_LENGTH).join("");
}

/** The paths a File's update may not name, and the door that writes them (docs/update-paths.md). */
export const FILE_REFUSED_UPDATE_PATHS: ReadonlyArray<RefusedUpdatePath> = [
  { path: "spec.filename", writtenBy: "upload" },
  { path: "spec.mime_type", writtenBy: "upload" },
  { path: "metadata.name", writtenBy: "upload" },
];

export interface UploadAuthorizationDeps {
  readonly store: Store;
  readonly authorizer: Authorizer;
  readonly credentialBinding: OrganizationAdmission;
}

/**
 * Authorizes an upload (or the URL for one) of `org`, into `sessionId`
 * when it is set (module header). A session nobody can find answers
 * NotFound through the authorizer's own refinement, or here when the row
 * is gone.
 */
export async function authorizeFileUpload(
  deps: UploadAuthorizationDeps,
  caller: CallerIdentity,
  org: string,
  sessionId: string,
): Promise<void> {
  await refuseBoundElsewhere(deps.credentialBinding, caller, org);
  if (sessionId === "") {
    await authorizeResolvedResource(
      deps.authorizer,
      caller,
      { permission: IamPermission.can_create_file, resourceKind: ApiResourceKind.organization, resourceId: org },
      UPLOAD_IN_ORGANIZATION_DENIED,
    );
    return;
  }
  await authorizeResolvedResource(
    deps.authorizer,
    caller,
    { permission: IamPermission.can_create_run_in, resourceKind: ApiResourceKind.session, resourceId: sessionId },
    UPLOAD_INTO_SESSION_DENIED,
  );
  let sessionOrg: string;
  try {
    sessionOrg = (await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema)).metadata?.org ?? "";
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("session", sessionId);
    }
    throw internalError(error, "failed to load session");
  }
  if (sessionOrg !== org) {
    throw failedPreconditionError(
      `session ${sessionId} belongs to another organization: upload into it under the session's organization`,
    );
  }
}

/** The chain's upload authorization over any input carrying `org` and `sessionId`. */
export function newAuthorizeUploadStep<Desc extends DescMessage>(
  deps: UploadAuthorizationDeps,
  target: (input: RequestContext<Desc>["input"]) => { readonly org: string; readonly sessionId: string },
): PipelineStep<Desc> {
  return {
    name: "AuthorizeFileUpload",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const { org, sessionId } = target(ctx.input);
      await authorizeFileUpload(deps, ctx.callerIdentity, org, sessionId);
    },
  };
}

/**
 * Stamps what the server knows about a new File on its status, after
 * BuildNewState cleared it and stamped the audit: its size, and the
 * conversation it belongs to (the parent tuple the authorization step
 * writes is read from here).
 */
export function newStampFileStatusStep(blob: NewBlob, sessionId: string): PipelineStep<typeof FileSchema> {
  return {
    name: "StampFileStatus",
    execute(ctx: RequestContext<typeof FileSchema>): void {
      const status = (ctx.newState.status ??= create(FileStatusSchema));
      status.sizeBytes = BigInt(blob.sizeBytes);
      status.sessionId = sessionId;
      status.runId = "";
    },
  };
}

/**
 * An update keeps what describes the bytes: the stored spec and name,
 * whatever a broad mask (`spec`, `*`) copied from the request.
 */
export function newKeepFileDescriptionStep(): PipelineStep<typeof FileSchema> {
  return {
    name: "KeepFileDescription",
    execute(ctx: RequestContext<typeof FileSchema>): void {
      // LoadExisting put the stored File here before BuildUpdateState ran.
      const stored = ctx.get(EXISTING_RESOURCE_KEY) as File;
      ctx.newState.spec = stored.spec;
      if (ctx.newState.metadata !== undefined) {
        ctx.newState.metadata.name = stored.metadata?.name ?? "";
      }
    },
  };
}

/** The refusal of a File a routine still names. */
export function fileStillNamedMessage(fileId: string, routines: readonly string[]): string {
  return `file ${fileId} is still named by ${routines.join(", ")}; remove it from them first`;
}

type DeleteDesc = typeof FileCommandController.method.delete.input;

/**
 * Refuses deleting a File a routine of its organization names in its
 * resources: the routine's next run would find it gone, and the person
 * deleting the File may not be able to edit the routine. A conversation
 * never blocks a delete: it holds its own copy, or the File is its own and
 * leaves its list in the same delete (newRemoveFromConversationStep).
 */
export function newGuardFileUnreferencedStep(store: Store): PipelineStep<DeleteDesc> {
  return {
    name: "GuardFileUnreferenced",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const file = ctx.get(EXISTING_RESOURCE_KEY) as File;
      const id = file.metadata?.id ?? "";
      const org = file.metadata?.org ?? "";
      const routines: string[] = [];
      try {
        for (const row of await store.queryResources(routineListIndex, { org })) {
          const routine = fromBinary(RoutineSchema, row.data);
          const names = (routine.spec?.agent?.resources ?? []).some(
            (entry) => entry.resource.case === "file" && entry.resource.value.fileId === id,
          );
          if (names) {
            routines.push(`routine '${routine.metadata?.slug ?? ""}'`);
          }
        }
      } catch (error) {
        throw internalError(error, "failed to read what names the file");
      }
      if (routines.length > 0) {
        throw failedPreconditionError(fileStillNamedMessage(id, routines.sort()));
      }
    },
  };
}

/**
 * A conversation's own File leaves the conversation's resources when it is
 * deleted, in the delete's own act: whoever may delete it (its uploader or
 * the conversation's owner) belongs to that conversation. Written inside the
 * store's synchronous modify of the session's row, so nothing written since
 * is undone. A conversation already gone holds nothing to remove.
 */
export function newRemoveFromConversationStep(store: Store): PipelineStep<DeleteDesc> {
  return {
    name: "RemoveFromConversation",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const file = ctx.get(EXISTING_RESOURCE_KEY) as File;
      const id = file.metadata?.id ?? "";
      const sessionId = file.status?.sessionId ?? "";
      if (sessionId === "") {
        return;
      }
      try {
        await store.updateResource(ApiResourceKind.session, sessionId, SessionSchema, (row) => {
          if (row.spec !== undefined) {
            row.spec.resources = row.spec.resources.filter(
              (entry) => !(entry.resource.case === "file" && entry.resource.value.fileId === id),
            );
          }
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return;
        }
        throw internalError(error, "failed to remove the file from its conversation");
      }
    },
  };
}

/**
 * Persist for an upload: the credential backstop every Persist runs, then
 * the File's row and its blob's ref in one transaction (blobs.ts
 * insertFile), whose refusals reach the client as they are; Persist's own
 * save would answer every one Internal.
 *
 * Then, for a File of a conversation, the conversation must still exist:
 * a delete that listed its Files before this row landed, and removed its
 * own row after, would leave this File behind. Either this read sees the
 * conversation gone and takes the File back, or the conversation's row
 * went after it and the delete's second pass over its Files
 * (session-files.ts) finds this one.
 */
export function newPersistUploadedFileStep(
  deps: { readonly store: Store; readonly credentialBinding: OrganizationAdmission; readonly blobs: FileBlobs },
  blob: NewBlob,
  sessionId: string,
): PipelineStep<typeof FileSchema> {
  return {
    name: "PersistUploadedFile",
    async execute(ctx: RequestContext<typeof FileSchema>): Promise<void> {
      const id = ctx.newState.metadata?.id ?? "";
      await refuseBoundElsewhere(deps.credentialBinding, ctx.callerIdentity, ctx.newState.metadata?.org ?? "");
      await deps.blobs.insertFile(id, FileSchema, ctx.newState, blob);
      if (sessionId === "") {
        return;
      }
      let gone = false;
      try {
        await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          throw internalError(error, "failed to load session");
        }
        gone = true;
      }
      if (gone) {
        await deps.blobs.removeFile(id);
        throw notFoundError("session", sessionId);
      }
    },
  };
}
