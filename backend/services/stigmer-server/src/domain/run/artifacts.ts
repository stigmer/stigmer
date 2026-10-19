/**
 * Artifact read surfaces — ports get_artifact_content.go and
 * get_artifact_download_url.go. A run's input files are Files
 * (domain/file/), named by id and read through their own links.
 *
 * getArtifactContent returns bytes through the API (no CORS concerns for
 * SDK consumers): key-prefix ownership check, CAS-blob serve-time
 * integrity (DATA_LOSS on mismatch, only over the complete object),
 * single-entry ZIP extraction (fflate — the chosen dependency; Node has
 * no stdlib ZIP), 512KB default truncation.
 *
 * getArtifactDownloadUrl returns a time-limited direct-download URL;
 * ownership is the artifacts/{execution_id}/ prefix. On local storage the
 * URL points at the port+1 artifact file server
 * (src/artifactstorage/file-server.ts).
 */
import path from "node:path";

import { unzipSync } from "fflate";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type {
  GetArtifactContentRequest,
  GetArtifactContentResponse,
  GetArtifactDownloadUrlRequest,
  GetArtifactDownloadUrlResponse,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import {
  GetArtifactContentResponseSchema,
  GetArtifactDownloadUrlResponseSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { create } from "@bufbuild/protobuf";

import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { casBlobContentMismatch } from "./filereview/cas-blob.js";

export interface ArtifactRpcDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly artifactStorage: ArtifactStorage;
  /**
   * The composed authorization seam — the two artifact READ surfaces
   * evaluate their can_view annotations before the ownership checks.
   * uploadAttachment stays checkless by
   * annotation (is_skip_authorization — the storage_key is the capability).
   */
  readonly authorizer: Authorizer;
}

/**
 * Default size limit when max_bytes is unset: the first 512 KB with
 * truncated=true when the full content exceeds it (Go
 * DefaultMaxArtifactContentBytes).
 */
export const DEFAULT_MAX_ARTIFACT_CONTENT_BYTES = 512 * 1024;

/**
 * Default expiration for artifact download URLs — R2's presigned-URL
 * maximum (Go DefaultArtifactURLExpiration).
 */
export const DEFAULT_ARTIFACT_URL_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Artifact-relevant extensions commonly missing from OS MIME databases
 * (Go knownContentTypes); checked before the generic table below.
 */
const KNOWN_CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  [".yaml", "text/yaml"],
  [".yml", "text/yaml"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
  [".xml", "application/xml"],
  [".html", "text/html"],
  [".zip", "application/zip"],
  [".tar", "application/x-tar"],
  [".gz", "application/gzip"],
  [".py", "text/x-python"],
  [".go", "text/x-go"],
  [".js", "text/javascript"],
  [".ts", "text/typescript"],
  [".sh", "text/x-shellscript"],
  [".toml", "application/toml"],
]);

/**
 * The stand-in for Go's mime.TypeByExtension (Node has no OS MIME
 * database binding): Go's mime package BUILTIN table verbatim, including
 * its charset-qualified text types — the deterministic subset both
 * editions agree on. Go additionally consults the OS mime.types database
 * for other extensions; that residue is an accepted, recorded parity gap
 * (everything else falls to octet-stream, Go's final default).
 */
const OS_MIME_FALLBACK: ReadonlyMap<string, string> = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".xml", "text/xml; charset=utf-8"],
]);

// ---------------------------------------------------------------------------
// getArtifactContent
// ---------------------------------------------------------------------------

export async function getArtifactContent(
  deps: ArtifactRpcDeps,
  req: GetArtifactContentRequest,
  identity: CallerIdentity,
): Promise<GetArtifactContentResponse> {
  if (req.runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  if (req.storageKey === "") {
    throw invalidArgumentError("storage_key is required");
  }
  // The annotation's can_view check (validate → authorize → ownership).
  await authorizeDirect(
    RunQueryController.method.getArtifactContent,
    deps.authorizer,
    identity,
    req,
  );

  // Ownership is checked on the NORMALIZED key and the normalized key is
  // what gets served: the storage layer path-cleans `.`/`..` segments, so
  // a raw-key prefix check would let `artifacts/{mine}/../{other}/f` pass
  // yet resolve into another execution's artifacts. Deliberate fail-closed
  // divergence from Go until stigmer/stigmer#858 lands there.
  const storageKey = path.posix.normalize(req.storageKey);
  const expectedPrefix = `artifacts/${req.runId}/`;
  if (!storageKey.startsWith(expectedPrefix)) {
    deps.logger.warn(
      "Storage key does not belong to execution - potential path traversal attempt",
      {
        executionId: req.runId,
        storageKey: req.storageKey,
        expectedPrefix,
      },
    );
    throw invalidArgumentError("storage_key does not belong to this execution");
  }

  // Existence check: only a missing execution is NotFound; any other store
  // failure is an infrastructure fault.
  try {
    await deps.store.getResource(
      ApiResourceKind.run,
      req.runId,
      RunSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw new ConnectError(
        `execution not found: ${req.runId}`,
        Code.NotFound,
      );
    }
    throw internalError(error, "failed to load agent execution");
  }

  let maxBytes = Number(req.maxBytes);
  if (maxBytes <= 0) {
    maxBytes = DEFAULT_MAX_ARTIFACT_CONTENT_BYTES;
  }

  let data: Uint8Array;
  try {
    data = await deps.artifactStorage.download(storageKey);
  } catch (error) {
    throw internalError(error, "failed to read artifact content");
  }

  // Serve-time integrity for CAS blobs — only over the COMPLETE object
  // (untruncated, no entry extraction); non-CAS keys fail open.
  if (req.entryPath === "" && data.length <= maxBytes) {
    const reason = casBlobContentMismatch(storageKey, data);
    if (reason !== "") {
      deps.logger.error("CAS blob failed content-address integrity check", {
        executionId: req.runId,
        storageKey: req.storageKey,
      });
      throw new ConnectError(reason, Code.DataLoss);
    }
  }

  // Single-entry ZIP extraction for directory artifacts.
  if (req.entryPath !== "") {
    const entryData = extractZipEntry(data, req.entryPath);
    if (entryData === undefined) {
      deps.logger.warn("Failed to extract entry from ZIP artifact", {
        executionId: req.runId,
        storageKey: req.storageKey,
        entryPath: req.entryPath,
      });
      throw new ConnectError(
        `entry ${JSON.stringify(req.entryPath)} not found in archive`,
        Code.NotFound,
      );
    }
    data = entryData;
  }

  const totalSize = data.length;
  let truncated = false;
  if (totalSize > maxBytes) {
    data = data.slice(0, maxBytes);
    truncated = true;
  }

  const contentKey = req.entryPath !== "" ? req.entryPath : storageKey;
  const contentType = detectContentType(contentKey);

  deps.logger.info("Successfully read artifact content", {
    executionId: req.runId,
    storageKey: req.storageKey,
    entryPath: req.entryPath,
    totalSizeBytes: totalSize,
    returnedBytes: data.length,
    truncated,
    contentType,
  });

  return create(GetArtifactContentResponseSchema, {
    content: data,
    contentType,
    totalSizeBytes: BigInt(totalSize),
    truncated,
  });
}

/**
 * Reads a single file from an in-memory ZIP archive (Go extractZipEntry
 * over archive/zip; here fflate's unzipSync with a name filter so only
 * the requested entry inflates). undefined = not found / unreadable.
 *
 * The max_bytes guard applies AFTER inflation (both editions): a crafted
 * entry inflates fully in memory first. Acceptable under the current
 * trust boundary — ZIP artifacts are runner-written, and single-user OSS
 * has no hostile tenant — revisit if artifacts ever become user-supplied.
 */
function extractZipEntry(
  zipData: Uint8Array,
  entryPath: string,
): Uint8Array | undefined {
  try {
    const extracted = unzipSync(zipData, {
      filter: (file) => file.name === entryPath,
    });
    return extracted[entryPath];
  } catch {
    return undefined;
  }
}

/**
 * MIME type from the extension: the artifact-relevant table first, the
 * OS-table stand-in second, octet-stream last (Go detectContentType).
 */
export function detectContentType(storageKey: string): string {
  const ext = fileExtension(storageKey);
  if (ext === "") {
    return "application/octet-stream";
  }
  return (
    KNOWN_CONTENT_TYPES.get(ext) ??
    OS_MIME_FALLBACK.get(ext) ??
    "application/octet-stream"
  );
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (dot <= slash || dot === -1) {
    return "";
  }
  return name.slice(dot).toLowerCase();
}

// ---------------------------------------------------------------------------
// getArtifactDownloadUrl
// ---------------------------------------------------------------------------

export async function getArtifactDownloadUrl(
  deps: ArtifactRpcDeps,
  req: GetArtifactDownloadUrlRequest,
  identity: CallerIdentity,
): Promise<GetArtifactDownloadUrlResponse> {
  if (req.runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  if (req.storageKey === "") {
    throw invalidArgumentError("storage_key is required");
  }
  // The annotation's can_view check (validate → authorize → ownership).
  await authorizeDirect(
    RunQueryController.method.getArtifactDownloadUrl,
    deps.authorizer,
    identity,
    req,
  );

  // Load BEFORE the key check: the attachment arm needs spec.attachments,
  // and this doubles as the existence check (a missing execution is
  // NotFound; any other store failure is an infrastructure fault).
  let execution: Run;
  try {
    execution = await deps.store.getResource(
      ApiResourceKind.run,
      req.runId,
      RunSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw new ConnectError(
        `execution not found: ${req.runId}`,
        Code.NotFound,
      );
    }
    throw internalError(error, "failed to load agent execution");
  }

  // Same normalize-before-check posture as getArtifactContent
  // (stigmer/stigmer#858).
  const storageKey = path.posix.normalize(req.storageKey);
  const expectedPrefix = `artifacts/${req.runId}/`;
  if (!storageKey.startsWith(expectedPrefix)) {
    deps.logger.warn(
      "Storage key does not belong to execution - potential path traversal attempt",
      {
        executionId: req.runId,
        storageKey: req.storageKey,
        expectedPrefix,
      },
    );
    throw invalidArgumentError("storage_key does not belong to this execution");
  }

  const expiresInMs = DEFAULT_ARTIFACT_URL_EXPIRATION_MS;
  const expiresAt = new Date(Date.now() + expiresInMs);

  // A browser download saves under the key's basename (already validated
  // to be scoped to this execution); empty serves inline.
  const downloadFilename = req.asAttachment
    ? (storageKey.split("/").pop() ?? "")
    : "";

  let downloadUrl: string;
  try {
    downloadUrl = await deps.artifactStorage.getSignedUrl(
      storageKey,
      expiresInMs,
      downloadFilename,
      "person",
    );
  } catch (error) {
    throw internalError(error, "failed to generate download URL");
  }

  deps.logger.info(
    "Successfully generated presigned download URL for artifact",
    {
      executionId: req.runId,
      storageKey: req.storageKey,
      expiresAt: expiresAt.toISOString(),
    },
  );

  return create(GetArtifactDownloadUrlResponseSchema, {
    downloadUrl,
    // RFC3339 seconds precision, Go's time.RFC3339 Format.
    expiresAt: expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
}
