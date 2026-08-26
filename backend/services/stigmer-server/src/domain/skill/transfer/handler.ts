/**
 * Skill artifact transfer lane — ports pkg/domain/skill/transfer/handler.go:
 * the HTTP upload/download surface that carries skill artifact bytes
 * OUTSIDE the gRPC control plane (#675). The gRPC server caps messages at
 * 10MB while the skill layer permits 100MB artifacts, so inline bytes
 * physically cannot carry every valid skill.
 *
 *   PUT {prefix}/uploads/{ref}  — stage artifact bytes (capability: ref)
 *   GET {prefix}/{storage_key}  — serve artifact bytes (capability: key)
 *
 * Neither route carries bearer auth by design: the URL is the credential,
 * mirroring cloud's pre-signed R2 URLs. Minting an upload URL requires the
 * same gRPC authorization as push; download keys are unguessable content
 * hashes handed out by authorized skill reads.
 *
 * The lane slots into the transport's existing skillTransferLane seam
 * (transport/server.ts lane 3); URL renderers live next to the route
 * dispatch so the URL shape and its handler cannot drift apart (Go's
 * stated invariant). Proven by __tests__/skill.test.ts's transfer-lane
 * block (both protocol stacks) and the conformance suite's transfer-lane
 * tests.
 */
import type { Logger } from "../../../boot/logger.js";
import { SKILL_ARTIFACTS_PATH_PREFIX } from "../../../transport/constants.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../../../transport/lanes.js";
import { DOWNLOAD_KEY_PREFIX, UPLOADS_SEGMENT } from "../constants.js";
import { ArtifactNotFoundError } from "../storage/artifact-storage.js";
import type { SkillArtifactStorage } from "../storage/artifact-storage.js";
import {
  SizeMismatchError,
  SlotConsumedError,
  SlotUnknownError,
} from "./slots.js";
import type { UploadSlots } from "./slots.js";

/**
 * Renders the capability URL for a minted reference against the lane's
 * externally-reachable base URL.
 */
export function uploadUrl(baseUrl: string, ref: string): string {
  return `${trimTrailingSlash(baseUrl)}${SKILL_ARTIFACTS_PATH_PREFIX}${UPLOADS_SEGMENT}${ref}`;
}

/** Renders the download URL for an artifact storage key. */
export function downloadUrl(baseUrl: string, storageKey: string): string {
  return `${trimTrailingSlash(baseUrl)}${SKILL_ARTIFACTS_PATH_PREFIX}/${storageKey}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Builds the lane handler (Go NewHandler). */
export function newSkillTransferLane(
  slots: UploadSlots,
  artifacts: SkillArtifactStorage,
  logger: Logger,
): LaneHandler {
  return (request: LaneRequest, response: LaneResponse): void => {
    const url = request.url ?? "";
    const pathOnly = url.split("?")[0] ?? "";
    if (!pathOnly.startsWith(SKILL_ARTIFACTS_PATH_PREFIX)) {
      // Unreachable through the lane router (it dispatches by this exact
      // prefix); kept as the honest Go http.NotFound arm for direct use.
      writeText(response, 404, "404 page not found");
      return;
    }
    const rest = pathOnly.slice(SKILL_ARTIFACTS_PATH_PREFIX.length);

    // The lane router is synchronous; the async handlers run detached. The
    // terminal catch is load-bearing: a response-write failure on a
    // vanished client would otherwise escape as an unhandled rejection —
    // process-fatal under Node's default policy.
    const logDetachedFailure = (arm: string) => (error: unknown) => {
      logger.error(`skill transfer lane ${arm} handler failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    };

    if (rest.startsWith(UPLOADS_SEGMENT)) {
      const ref = rest.slice(UPLOADS_SEGMENT.length);
      handleUpload(request, response, slots, ref, logger).catch(
        logDetachedFailure("upload"),
      );
      return;
    }

    handleDownload(
      request,
      response,
      artifacts,
      rest.replace(/^\//, ""),
      logger,
    ).catch(logDetachedFailure("download"));
  };
}

async function handleUpload(
  request: LaneRequest,
  response: LaneResponse,
  slots: UploadSlots,
  ref: string,
  logger: Logger,
): Promise<void> {
  if (request.method !== "PUT") {
    response.setHeader("Allow", "PUT");
    writeText(response, 405, "method not allowed");
    return;
  }

  try {
    await slots.receive(ref, request);
    response.statusCode = 204;
    response.end();
  } catch (error) {
    if (error instanceof SlotUnknownError) {
      // Deliberately the same shape for "never existed" and "expired":
      // distinguishing them would let an unauthorized caller probe which
      // tokens were once valid.
      writeText(response, 404, "upload reference unknown or expired — request a new upload URL");
    } else if (error instanceof SlotConsumedError) {
      writeText(response, 409, "upload reference already used — request a new upload URL");
    } else if (error instanceof SizeMismatchError) {
      writeText(
        response,
        400,
        `${error.message} — the upload must match the size declared to createArtifactUploadUrl`,
      );
    } else {
      logger.error("skill artifact upload failed", {
        ref,
        error: error instanceof Error ? error.message : String(error),
      });
      writeText(response, 500, "failed to stage upload");
    }
  }
}

async function handleDownload(
  request: LaneRequest,
  response: LaneResponse,
  artifacts: SkillArtifactStorage,
  key: string,
  logger: Logger,
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    writeText(response, 405, "method not allowed");
    return;
  }
  if (!key.startsWith(DOWNLOAD_KEY_PREFIX)) {
    writeText(response, 404, "404 page not found");
    return;
  }

  let data: Uint8Array;
  try {
    // Full in-memory read matches the store's own interface (get returns
    // bytes) and the ≤100MB validation ceiling bounds the allocation.
    data = await artifacts.get(key);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      writeText(response, 404, "404 page not found");
      return;
    }
    logger.error("skill artifact download failed", {
      storageKey: key,
      error: error instanceof Error ? error.message : String(error),
    });
    writeText(response, 500, "failed to load artifact");
    return;
  }

  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Content-Length", String(data.length));
  response.statusCode = 200;
  response.end(Buffer.from(data));
}

/** Go http.Error's shape: text/plain body with a trailing newline. */
function writeText(response: LaneResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(`${body}\n`);
}
