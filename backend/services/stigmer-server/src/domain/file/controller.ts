/**
 * File controller: the kind's command and query sides. A File is a file
 * uploaded once and named by its id; its bytes live in the File store
 * (blobs.ts) under a key no message carries.
 *
 * upload runs in two chains. The first, over the request, opens with
 * Authorize (the contract's skip-authorization), then asks the request's
 * own permission (steps.ts AuthorizeFileUpload): into a conversation,
 * can_create_run_in on it; otherwise can_create_file on the organization.
 * The bytes are then written to a new blob (inline) or promoted from an
 * upload URL's staging key by a copy inside the store (staged), and the
 * second chain builds the File the server names (BuildNewState mints its
 * id and audit; StampFileStatus writes its size and conversation), stores
 * its row with its blob's ref in one transaction, and writes its access:
 * its uploader as owner, its organization, and the conversation it
 * belongs to as its parent. A failure after the bytes leaves a leased,
 * orphaned blob that the sweep deletes.
 *
 * createUploadUrl asks what upload will and mints a URL for exactly the
 * declared size. update changes labels and tags only (steps.ts
 * FILE_REFUSED_UPDATE_PATHS). delete sweeps expired blobs first, then
 * removes the row and its ref, then the bytes when no other File shares
 * them. getDownloadUrl signs a person's link for an hour.
 *
 * list narrows the organization's Files, or one conversation's, through
 * the composed list read scope to the ones a `get` would return. Not
 * search-indexed: the kind declares not_search_indexed. Per-RPC posture:
 * docs/authorization-coverage.md.
 *
 * Proven by __tests__/file.test.ts (composed-server round trips) and
 * file.conformance.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import {
  FileDownloadUrlSchema,
  FileListSchema,
  FileUploadUrlSchema,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import type {
  CreateFileUploadUrlInput,
  FileDownloadUrl,
  FileId,
  FileList,
  FileUploadUrl,
  ListFilesRequest,
  UpdateFileInput,
  UploadFileInput,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { FileSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/spec_pb";
import { FileStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { UpdateVisibilityInput } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  newCleanupGrantsStep,
  newCreateAuthorizationTuplesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep, setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { matchesAllLabels, sortedLabels } from "../../pipeline/steps/helpers.js";
import { decodeOrSkip, listPageFingerprint, readListPage } from "../../pipeline/steps/list-page.js";
import { EXISTING_RESOURCE_KEY, newLoadExistingStep } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { updateContext } from "../../pipeline/steps/update-input.js";
import { newValidateVisibilityUpdateStep } from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { FileBlobs, NewBlob } from "./blobs.js";
import { fileListIndex } from "./list-index.js";
import { fileMimeType } from "./mime.js";
import {
  FILE_REFUSED_UPDATE_PATHS,
  fileNameOf,
  newAuthorizeUploadStep,
  newKeepFileDescriptionStep,
  newStampFileStatusStep,
} from "./steps.js";

export interface FileControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed credential binding: an upload and the persist backstop refuse a credential that does not reach the organization. */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — list narrows through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  /** The File store's bytes (blobs.ts). */
  readonly blobs: FileBlobs;
}

/** Registers both File services on the router (routes stage). */
export function registerFileServices(router: ConnectRouter, deps: FileControllerDeps): void {
  router.service(FileCommandController, {
    upload: (input, ctx) => upload(deps, input, ctx),
    createUploadUrl: (input, ctx) => createUploadUrl(deps, input, ctx),
    update: (input, ctx) => update(deps, input, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (input, ctx) => deleteFile(deps, input, ctx),
  });
  router.service(FileQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    getDownloadUrl: (id, ctx) => getDownloadUrl(deps, id, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/** The noun every not-found answer names. */
const FILE_NOUN = "file";

type UploadDesc = typeof FileCommandController.method.upload.input;

/** Upload — the request's own authorization, the bytes, then the File (module header). */
async function upload(deps: FileControllerDeps, input: UploadFileInput, ctx: HandlerContext): Promise<File> {
  const caller = callerIdentityOf(ctx);
  const admitted = new RequestContext(FileCommandController.method.upload.input, input, caller, kindOf(ctx));
  await newPipeline<UploadDesc>("file-upload-admit", deps.logger)
    .addStep(newAuthorizeStep(FileCommandController.method.upload, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newAuthorizeUploadStep<UploadDesc>(deps, (request) => request))
    .build()
    .execute(admitted);

  const mimeType = fileMimeType(input.filename, input.mimeType);
  // ValidateProto refused a request with no source (the oneof is required),
  // so a source that is not a reference is inline bytes.
  const blob: NewBlob =
    input.source.case === "uploadRef"
      ? await deps.blobs.promote(input.org, input.source.value)
      : await deps.blobs.storeInline(input.org, input.source.value ?? new Uint8Array(), mimeType);

  const file = create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: create(ApiResourceMetadataSchema, {
      org: input.org,
      name: fileNameOf(input.filename),
    }),
    spec: create(FileSpecSchema, { filename: input.filename, mimeType }),
  });
  const reqCtx = new RequestContext(FileSchema, file, caller, kindOf(ctx));
  await newPipeline<typeof FileSchema>("file-upload", deps.logger)
    .addStep(newBuildNewStateStep())
    .addStep(newStampFileStatusStep(blob, input.sessionId))
    .addStep(newValidateProtoStep({ of: "state" }))
    .addStep(
      newPersistStep(deps.store, deps.credentialBinding, (state) =>
        deps.blobs.insertFile(state.metadata?.id ?? "", FileSchema, state, blob),
      ),
    )
    .addStep(newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

type MintDesc = typeof FileCommandController.method.createUploadUrl.input;

/** CreateUploadUrl — asks what upload will, then mints a URL for exactly the declared size. */
async function createUploadUrl(
  deps: FileControllerDeps,
  input: CreateFileUploadUrlInput,
  ctx: HandlerContext,
): Promise<FileUploadUrl> {
  const reqCtx = new RequestContext(
    FileCommandController.method.createUploadUrl.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<MintDesc>("file-create-upload-url", deps.logger)
    .addStep(newAuthorizeStep(FileCommandController.method.createUploadUrl, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newAuthorizeUploadStep<MintDesc>(deps, (request) => request))
    .build()
    .execute(reqCtx);
  const minted = await deps.blobs.mintUpload(input.org, Number(input.sizeBytes));
  return create(FileUploadUrlSchema, {
    url: minted.url,
    uploadRef: minted.ref,
    ttlSeconds: Math.floor(minted.ttlMs / 1000),
  });
}

/** Update — labels and tags; the bytes' description keeps its stored value. */
async function update(deps: FileControllerDeps, input: UpdateFileInput, ctx: HandlerContext): Promise<File> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(FileSchema, input, callerIdentityOf(ctx), kindOf(ctx));
    await newPipeline<typeof FileSchema>("file-update", deps.logger)
      .addStep(newAuthorizeStep(FileCommandController.method.update, deps.authorizer, input))
      .addStep(newResolveSlugStep({ update: true }))
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep({ refused: FILE_REFUSED_UPDATE_PATHS }))
      .addStep(newKeepFileDescriptionStep())
      .addStep(newValidateProtoStep({ of: "state" }))
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newPersistStep(deps.store, deps.credentialBinding))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
}

/** Sweeps a bounded batch of expired blobs before a delete, the write that frees bytes. */
function newSweepExpiredBlobsStep(
  blobs: FileBlobs,
): PipelineStep<typeof FileCommandController.method.delete.input> {
  return {
    name: "SweepExpiredFileBlobs",
    async execute(): Promise<void> {
      await blobs.sweep();
    },
  };
}

/** Delete — the row and its ref, then the bytes when no other File shares them, then its access. */
async function deleteFile(deps: FileControllerDeps, input: FileId, ctx: HandlerContext): Promise<File> {
  const reqCtx = new RequestContext(FileCommandController.method.delete.input, input, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof FileCommandController.method.delete.input>("file-delete", deps.logger)
    .addStep(newAuthorizeStep(FileCommandController.method.delete, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, FileSchema))
    .addStep(newSweepExpiredBlobsStep(deps.blobs))
    .addStep(newDeleteResourceStep(deps.store, (id) => deps.blobs.removeFile(id)))
    .addStep(newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(EXISTING_RESOURCE_KEY) as File;
}

// ─── updateVisibility ────────────────────────────────────────────────────
// A targeted metadata update: only metadata.visibility changes. Load runs
// before level validation so NOT_FOUND wins.
// ─────────────────────────────────────────────────────────────────────────

export const UPDATE_VISIBILITY_FILE_KEY = "updateVisibilityFile";

type UpdateVisibilityDesc = typeof FileCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: FileControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<File> {
  const reqCtx = new RequestContext(
    FileCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>("file-update-visibility", deps.logger)
    .addStep(newAuthorizeStep(FileCommandController.method.updateVisibility, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadFileForVisibilityUpdateStep(deps.store))
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_FILE_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newSetFileVisibilityStep())
    .addStep(newPersistFileVisibilityStep(deps.store))
    .addStep(newUpdateVisibilityTuplesStep(deps.authorizationLifecycle, UPDATE_VISIBILITY_FILE_KEY))
    .build()
    .execute(reqCtx);
  return reqCtx.get(UPDATE_VISIBILITY_FILE_KEY) as File;
}

/** Loads the File by resource_id; a missing one answers NotFound, a store fault Internal. */
export function newLoadFileForVisibilityUpdateStep(store: Store): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadFileForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      let file: File;
      try {
        file = await store.getResource(ctx.apiResourceKind, ctx.input.resourceId, FileSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(FILE_NOUN, ctx.input.resourceId);
        }
        throw internalError(error, "failed to load file");
      }
      ctx.set(UPDATE_VISIBILITY_FILE_KEY, file);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot. */
function newSetFileVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetFileVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const file = ctx.get(UPDATE_VISIBILITY_FILE_KEY) as File;
      if (file.metadata !== undefined) {
        file.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(FileSchema, file, "status_audit", ctx.callerIdentity);
    },
  };
}

/**
 * The visibility and status audit the chain set, applied to the live row
 * inside the store's atomic write, so a label update that landed since the
 * load stays.
 */
export function newPersistFileVisibilityStep(store: Store): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistFileForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const file = ctx.get(UPDATE_VISIBILITY_FILE_KEY) as File;
      const id = file.metadata?.id ?? "";
      let written: File;
      try {
        written = await store.updateResource(ctx.apiResourceKind, id, FileSchema, (row) => {
          if (row.metadata !== undefined) {
            row.metadata.visibility = file.metadata?.visibility ?? row.metadata.visibility;
          }
          const audit = ((row.status ??= create(FileStatusSchema)).audit ??= create(ApiResourceAuditSchema));
          audit.statusAudit = file.status?.audit?.statusAudit;
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(FILE_NOUN, id);
        }
        throw internalError(error, "failed to save file");
      }
      ctx.set(UPDATE_VISIBILITY_FILE_KEY, written);
    },
  };
}

/** Get — LoadTarget by id. */
async function get(deps: FileControllerDeps, id: FileId, ctx: HandlerContext): Promise<File> {
  const reqCtx = new RequestContext(FileQueryController.method.get.input, id, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof FileQueryController.method.get.input>("file-get", deps.logger)
    .addStep(newAuthorizeStep(FileQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, FileSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as File;
}

const DOWNLOAD_URL_KEY = "fileDownloadUrl";

/** GetDownloadUrl — the File as `get` loads it, then a person's link to its bytes. */
async function getDownloadUrl(deps: FileControllerDeps, id: FileId, ctx: HandlerContext): Promise<FileDownloadUrl> {
  const reqCtx = new RequestContext(
    FileQueryController.method.getDownloadUrl.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof FileQueryController.method.getDownloadUrl.input>("file-get-download-url", deps.logger)
    .addStep(newAuthorizeStep(FileQueryController.method.getDownloadUrl, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, FileSchema))
    .addStep({
      name: "SignFileDownloadUrl",
      async execute(step: RequestContext<typeof FileQueryController.method.getDownloadUrl.input>): Promise<void> {
        const file = step.get(TARGET_RESOURCE_KEY) as File;
        const link = await deps.blobs.downloadUrl(file.metadata?.id ?? "", file.spec?.filename ?? "");
        step.set(
          DOWNLOAD_URL_KEY,
          create(FileDownloadUrlSchema, { url: link.url, expiresAt: timestampFromMs(link.expiresAtMs) }),
        );
      },
    })
    .build()
    .execute(reqCtx);
  return reqCtx.get(DOWNLOAD_URL_KEY) as FileDownloadUrl;
}

const LIST_RESULT_KEY = "listResult";

/** List — the Files of an organization, or of one conversation, the caller may view, newest first. */
async function list(deps: FileControllerDeps, req: ListFilesRequest, ctx: HandlerContext): Promise<FileList> {
  const reqCtx = new RequestContext(FileQueryController.method.list.input, req, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof FileQueryController.method.list.input>("file-list", deps.logger)
    .addStep(newAuthorizeStep(FileQueryController.method.list, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newListStep(deps.store, deps.listReadScope, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(LIST_RESULT_KEY) as FileList;
}

/** One page of the organization's (or conversation's) Files through the list index, narrowed to the caller's. */
function newListStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
  logger: Logger,
): PipelineStep<typeof FileQueryController.method.list.input> {
  return {
    name: "ListByOrg",
    async execute(ctx: RequestContext<typeof FileQueryController.method.list.input>): Promise<void> {
      const { org, sessionId } = ctx.input;
      const page = await readListPage({
        store,
        declaration: fileListIndex,
        query:
          sessionId === ""
            ? { org }
            : { org, anyKey: [{ name: "session", value: sessionId }] },
        request: { pageSize: ctx.input.pageSize, pageToken: ctx.input.pageToken },
        fingerprint: listPageFingerprint({
          org,
          session: sessionId,
          labels: sortedLabels(ctx.input.labels),
        }),
        decode: decodeOrSkip<File>(FileSchema, { logger, message: "Failed to unmarshal File, skipping" }),
        keep: (file) =>
          (file.metadata?.org ?? "") === org &&
          (sessionId === "" || (file.status?.sessionId ?? "") === sessionId) &&
          matchesAllLabels(file.metadata?.labels ?? {}, ctx.input.labels),
        scope: (rows) => restrictListByReadScope(listReadScope, ctx.callerIdentity, ApiResourceKind.file, rows, ""),
        failure: "failed to list Files",
      });
      ctx.set(LIST_RESULT_KEY, create(FileListSchema, { entries: page.entries, nextPageToken: page.nextPageToken }));
    },
  };
}
