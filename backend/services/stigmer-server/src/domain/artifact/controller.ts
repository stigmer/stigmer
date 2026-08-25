/**
 * Artifact controller — ports pkg/domain/artifact (command + query sides).
 * Artifact is the execution-output store (T07): a metadata resource in the
 * generic resources table plus a blob in ArtifactStorage, keyed by the
 * content's SHA-256 (content-addressable).
 *
 * Direct handlers, matching Go: create takes CreateArtifactInput (spec +
 * content bytes — not a HasMetadata resource), delete is a soft
 * storage_state transition rather than the hard-delete pipeline; only
 * get/listByExecution ride pipelines. Proven by
 * artifact.conformance.test.ts (CONFORMANCE_TARGET=local, incl. the
 * file-server lane) and __tests__/artifact.test.ts.
 *
 * Go tolerates a nil ArtifactStorage (two-phase wiring) and answers
 * Internal "artifact storage not configured"; the TS composition root
 * cannot produce that state — the dependency is required, and a missing
 * one is a compile error (the modeled-not-nullable idiom). The nil-guard
 * arms are therefore not ported.
 *
 * Versus Stigmer Cloud, OSS derives the artifact's org from its source
 * execution BEST-EFFORT (fabricated ids fall back to an empty org — what
 * makes the domain standalone-testable), where the multi-tenant edition
 * requires a real org-carrying source (the wave-2 disclosed edition split).
 */
import { createHash } from "node:crypto";

import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  ArtifactSchema,
  ArtifactStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ArtifactStorageState } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/enum_pb";
import {
  ArtifactDownloadUrlSchema,
  ArtifactListSchema,
  GetArtifactContentResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import type {
  ArtifactDownloadUrl,
  ArtifactId,
  ArtifactList,
  CreateArtifactInput,
  GetArtifactContentRequest,
  GetArtifactContentResponse,
  ListArtifactsByExecutionRequest,
} from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import { ArtifactQueryController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/query_pb";
import type { ArtifactSource } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceId } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  generateId,
  setAuditFieldsForCreate,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import {
  ARTIFACT_KIND,
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_TTL_DAYS,
  DOWNLOAD_URL_EXPIRATION_MS,
  MAX_CONTENT_BYTES,
  PERMANENT_TTL_MARKER,
  artifactBlobDeletedMessage,
  artifactNotFoundMessage,
} from "./constants.js";

export interface ArtifactControllerDeps {
  readonly store: Store;
  readonly artifactStorage: ArtifactStorage;
  readonly logger: Logger;
}

/** Registers both artifact services on the router (routes stage). */
export function registerArtifactServices(
  router: ConnectRouter,
  deps: ArtifactControllerDeps,
): void {
  router.service(ArtifactCommandController, {
    create: (input) => createArtifact(deps, input),
    delete: (id) => deleteArtifact(deps, id),
  });
  router.service(ArtifactQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    listByExecution: (req, ctx) => listByExecution(deps, req, ctx),
    getDownloadUrl: (id) => getDownloadUrl(deps, id),
    getContent: (req) => getContent(deps, req),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — Go's direct handler, step for step: validate spec/content/
 * source, SHA-256 the content (the hex hash IS the blob key), upload,
 * derive org best-effort, build the resource with an art_ id and the
 * content-addressed status, persist. The audit-field failure is LOG-ONLY
 * (Go behavior); the empty-content arm is normally answered by
 * protovalidate before this code runs, and the 50MB cap sits behind the
 * transport's 10MB message cap — both arms stay unit-level (the wave-2 S1
 * amendment names this port as their carrier).
 */
async function createArtifact(
  deps: ArtifactControllerDeps,
  input: CreateArtifactInput,
): Promise<Artifact> {
  const spec = input.spec;
  if (spec === undefined) {
    throw invalidArgumentError("spec is required");
  }
  const content = input.content;
  if (content.length === 0) {
    throw invalidArgumentError("content is required");
  }
  if (content.length > MAX_CONTENT_BYTES) {
    throw new ConnectError(
      `content exceeds maximum size of ${MAX_CONTENT_BYTES} bytes`,
      Code.ResourceExhausted,
    );
  }
  const source = spec.source;
  if (
    source === undefined ||
    (source.workflowExecutionId === "" && source.agentExecutionId === "")
  ) {
    throw invalidArgumentError(
      "spec.source must include workflow_execution_id or agent_execution_id",
    );
  }

  const contentHash = createHash("sha256").update(content).digest("hex");

  deps.logger.info("creating artifact", {
    contentHash,
    contentSize: content.length,
    contentType: spec.contentType,
    displayName: spec.displayName,
  });

  try {
    await deps.artifactStorage.upload(contentHash, content, spec.contentType);
  } catch (error) {
    deps.logger.error("failed to upload artifact blob", {
      contentHash,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to upload artifact content");
  }

  const org = await deriveOrgFromSource(deps, source);

  const artifactId = generateId("art");
  const artifact = create(ArtifactSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: ARTIFACT_KIND,
    metadata: {
      id: artifactId,
      name: spec.displayName,
      org,
    },
    spec,
    status: {
      contentHash,
      sizeBytes: BigInt(content.length),
      storageState: ArtifactStorageState.storage_state_stored,
      expiresAt: computeExpiresAt(spec.retention?.ttlDays),
    },
  });

  // Go: SetAuditFieldsForCreate failure is LOG-ONLY — an artifact write
  // must not fail over audit stamping.
  try {
    setAuditFieldsForCreate(ArtifactSchema, artifact);
  } catch (error) {
    deps.logger.error("failed to set audit fields on artifact", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await deps.store.saveResource(
      ApiResourceKind.artifact,
      artifactId,
      ArtifactSchema,
      artifact,
    );
  } catch (error) {
    deps.logger.error("failed to persist artifact metadata", {
      artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to persist artifact");
  }

  deps.logger.info("artifact created successfully", {
    artifactId,
    contentHash,
    sizeBytes: content.length,
  });

  return artifact;
}

/**
 * Go deriveOrgFromSource — the wire-layout proxy trick: every Stigmer
 * resource shares the metadata wire position (field 3 =
 * ApiResourceMetadata), so the Artifact schema reads metadata.org from any
 * execution kind without importing execution-specific protos. Best-effort
 * by design: unknown/fabricated executions fall back to the empty org (the
 * OSS single-user posture, pinned by the suite).
 */
async function deriveOrgFromSource(
  deps: ArtifactControllerDeps,
  source: ArtifactSource,
): Promise<string> {
  const lookups: Array<{ id: string; kind: ApiResourceKind }> = [
    { id: source.workflowExecutionId, kind: ApiResourceKind.workflow_execution },
    { id: source.agentExecutionId, kind: ApiResourceKind.agent_execution },
  ];
  for (const lookup of lookups) {
    if (lookup.id === "") {
      continue;
    }
    try {
      const proxy = await deps.store.getResource(
        lookup.kind,
        lookup.id,
        ArtifactSchema,
      );
      const org = proxy.metadata?.org ?? "";
      if (org !== "") {
        return org;
      }
    } catch {
      // Best-effort: a missing or unreadable source is not an error.
    }
  }
  return "";
}

/** Go computeExpiresAt: 30-day default; -1 permanent; <=0 falls back. */
function computeExpiresAt(ttlDaysInput: number | undefined): string {
  let ttlDays = ttlDaysInput ?? DEFAULT_TTL_DAYS;
  if (ttlDays === PERMANENT_TTL_MARKER) {
    return ""; // never expires
  }
  if (ttlDays <= 0) {
    ttlDays = DEFAULT_TTL_DAYS;
  }
  const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  // RFC3339 without fractional seconds — Go time.Format(time.RFC3339)
  // (the store/lifecycle modules use the same idiom).
  return expires.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Delete — Go's soft delete: a storage_state transition + save, never a
 * row removal (the metadata row is the audit trail of what an execution
 * produced; the blob is left for GC). Stamps status_audit only — a status
 * transition, not a spec change (#540). The response is the STORED
 * resource, exactly as Go returns it.
 */
async function deleteArtifact(
  deps: ArtifactControllerDeps,
  id: ApiResourceId,
): Promise<Artifact> {
  const resourceId = id.value;
  if (resourceId === "") {
    throw invalidArgumentError("artifact id is required");
  }

  const artifact = await loadArtifactOrNotFound(deps, resourceId);

  deps.logger.info("soft-deleting artifact", {
    artifactId: resourceId,
    previousState: ArtifactStorageState[artifact.status?.storageState ?? 0],
  });

  if (artifact.status === undefined) {
    artifact.status = create(ArtifactStatusSchema);
  }
  artifact.status.storageState = ArtifactStorageState.storage_state_deleted;

  // Soft-delete is a status transition: stamp status_audit only — cloud
  // currently stamps neither slot; OSS stays honest rather than copying
  // that omission (stigmer/stigmer#540). Failure is LOG-ONLY, as in Go.
  try {
    setAuditFieldsForUpdate(ArtifactSchema, artifact, "status_audit");
  } catch (error) {
    deps.logger.error("failed to set audit fields on artifact delete", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await deps.store.saveResource(
      ApiResourceKind.artifact,
      resourceId,
      ArtifactSchema,
      artifact,
    );
  } catch (error) {
    deps.logger.error("failed to persist artifact deletion", {
      artifactId: resourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to persist artifact deletion");
  }

  deps.logger.info("artifact soft-deleted successfully", {
    artifactId: resourceId,
  });

  return artifact;
}

/** Get — Go's two-step pipeline (ValidateProto → LoadTarget). */
async function get(
  deps: ArtifactControllerDeps,
  id: ArtifactId,
  ctx: HandlerContext,
): Promise<Artifact> {
  const reqCtx = new RequestContext(
    ArtifactQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof ArtifactQueryController.method.get.input>(
    "artifact-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ArtifactSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Artifact;
}

const ARTIFACT_LIST_KEY = "artifactList";

/**
 * ListByExecution — Go's custom pipeline: an at-least-one-filter check,
 * then a FULL ListResources scan with an in-memory source filter (the Go
 * doc comment claims FindAllByField; the CODE full-scans — the port
 * mirrors the code, the mismatch is disclosed in the PR), unmarshal
 * failures skipped, TotalPages hardcoded to 1.
 */
async function listByExecution(
  deps: ArtifactControllerDeps,
  req: ListArtifactsByExecutionRequest,
  ctx: HandlerContext,
): Promise<ArtifactList> {
  const reqCtx = new RequestContext(
    ArtifactQueryController.method.listByExecution.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof ArtifactQueryController.method.listByExecution.input>(
    "artifact-list-by-execution",
    deps.logger,
  )
    .addStep({
      name: "ValidateListByExecutionRequest",
      execute(stepCtx): void {
        const input = stepCtx.input;
        if (input.workflowExecutionId === "" && input.agentExecutionId === "") {
          throw invalidArgumentError(
            "workflow_execution_id or agent_execution_id is required",
          );
        }
      },
    })
    .addStep({
      name: "QueryArtifactsByExecution",
      async execute(stepCtx): Promise<void> {
        const input = stepCtx.input;
        let data: Uint8Array[];
        try {
          data = await deps.store.listResources(ApiResourceKind.artifact);
        } catch (error) {
          throw internalError(error, "failed to list artifacts");
        }

        const artifacts: Artifact[] = [];
        for (const bytes of data) {
          let artifact: Artifact;
          try {
            artifact = fromBinary(ArtifactSchema, bytes);
          } catch (error) {
            deps.logger.warn("failed to unmarshal artifact, skipping", {
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
          const source = artifact.spec?.source;
          if (
            input.workflowExecutionId !== "" &&
            source?.workflowExecutionId === input.workflowExecutionId
          ) {
            artifacts.push(artifact);
          } else if (
            input.agentExecutionId !== "" &&
            source?.agentExecutionId === input.agentExecutionId
          ) {
            artifacts.push(artifact);
          }
        }

        stepCtx.set(
          ARTIFACT_LIST_KEY,
          create(ArtifactListSchema, { totalPages: 1, entries: artifacts }),
        );
      },
    })
    .build()
    .execute(reqCtx);

  const list = reqCtx.get(ARTIFACT_LIST_KEY);
  if (list === undefined) {
    throw internalError(
      new Error("artifact list missing from pipeline context"),
      "artifact list not found in pipeline context",
    );
  }
  return list as ArtifactList;
}

/**
 * GetDownloadUrl — Go's direct handler: load, refuse deleted blobs, mint
 * the storage URL. ttl_seconds reports the 7-day constant UNCONDITIONALLY
 * (ratified P3): local URLs never actually expire — pinned as the wire
 * contract, the semantic mismatch disclosed in the wave-2 PR. The empty
 * download filename keeps the URL inline; attachment disposition is
 * opt-in only on the AgentExecution artifact download path.
 */
async function getDownloadUrl(
  deps: ArtifactControllerDeps,
  id: ArtifactId,
): Promise<ArtifactDownloadUrl> {
  const resourceId = id.value;
  if (resourceId === "") {
    throw invalidArgumentError("artifact id is required");
  }

  const artifact = await loadArtifactOrNotFound(deps, resourceId);
  const contentHash = requireLiveBlob(artifact, resourceId);

  deps.logger.info("generating download URL for artifact", {
    artifactId: resourceId,
    contentHash,
  });

  let downloadUrl: string;
  try {
    downloadUrl = await deps.artifactStorage.getSignedUrl(
      contentHash,
      DOWNLOAD_URL_EXPIRATION_MS,
      "",
    );
  } catch (error) {
    deps.logger.error("failed to generate download URL for artifact", {
      artifactId: resourceId,
      contentHash,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to generate download URL");
  }

  return create(ArtifactDownloadUrlSchema, {
    url: downloadUrl,
    ttlSeconds: Math.floor(DOWNLOAD_URL_EXPIRATION_MS / 1000),
    sizeBytes: artifact.status?.sizeBytes ?? 0n,
    contentType: artifact.spec?.contentType ?? "",
  });
}

/**
 * GetContent — Go's direct handler: the artifact bytes in the response
 * (no CORS concerns for SDK consumers), truncated to max_bytes with the
 * FULL blob size reported. Default/implicit cap 512KB, matching
 * AgentExecution.GetArtifactContent so the two content-read endpoints
 * behave identically.
 */
async function getContent(
  deps: ArtifactControllerDeps,
  req: GetArtifactContentRequest,
): Promise<GetArtifactContentResponse> {
  const artifactId = req.artifactId;
  if (artifactId === "") {
    throw invalidArgumentError("artifact_id is required");
  }

  const artifact = await loadArtifactOrNotFound(deps, artifactId);
  const contentHash = requireLiveBlob(artifact, artifactId);

  let maxBytes = req.maxBytes;
  if (maxBytes <= 0n) {
    maxBytes = DEFAULT_MAX_CONTENT_BYTES;
  }

  let data: Uint8Array;
  try {
    data = await deps.artifactStorage.download(contentHash);
  } catch (error) {
    deps.logger.error("failed to download artifact content", {
      artifactId,
      contentHash,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to read artifact content");
  }

  const totalSize = BigInt(data.length);
  let truncated = false;
  if (totalSize > maxBytes) {
    data = data.subarray(0, Number(maxBytes));
    truncated = true;
  }

  deps.logger.info("read artifact content", {
    artifactId,
    totalSizeBytes: data.length,
    truncated,
  });

  return create(GetArtifactContentResponseSchema, {
    content: data,
    contentType: artifact.spec?.contentType ?? "",
    totalSizeBytes: totalSize,
    truncated,
  });
}

/** Load by id with the byte-pinned Go NotFound copy. */
async function loadArtifactOrNotFound(
  deps: ArtifactControllerDeps,
  artifactId: string,
): Promise<Artifact> {
  try {
    return await deps.store.getResource(
      ApiResourceKind.artifact,
      artifactId,
      ArtifactSchema,
    );
  } catch {
    // Go answers NotFound for ANY store failure here (status.Errorf on
    // err != nil), not only missing rows — mirrored.
    throw new ConnectError(artifactNotFoundMessage(artifactId), Code.NotFound);
  }
}

/**
 * The shared deleted-blob and missing-hash guards of the two blob-read
 * surfaces (Go repeats them inline in both handlers).
 */
function requireLiveBlob(artifact: Artifact, artifactId: string): string {
  if (
    artifact.status?.storageState === ArtifactStorageState.storage_state_deleted
  ) {
    throw new ConnectError(
      artifactBlobDeletedMessage(artifactId),
      Code.FailedPrecondition,
    );
  }
  const contentHash = artifact.status?.contentHash ?? "";
  if (contentHash === "") {
    throw internalError(
      new Error(`artifact has no content hash: ${artifactId}`),
      `artifact has no content hash: ${artifactId}`,
    );
  }
  return contentHash;
}
