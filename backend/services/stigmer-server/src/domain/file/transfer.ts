/**
 * The Files transfer lane: the HTTP surface that carries a File's bytes
 * outside the gRPC control plane when the File store is the local one, on
 * the unified port beside the skill lane (transport/server.ts). A bucket
 * signs its URLs straight to the bucket, and this lane carries nothing for
 * it.
 *
 *   PUT /v1/file-transfer/uploads/{ref}  stage an upload (capability: ref)
 *   GET /v1/file-transfer/{key}          a File's bytes (capability: a signed link)
 *
 * Neither route carries bearer auth: the URL is the credential, as a
 * bucket's presigned URLs are. An upload reference is minted only by an
 * authorized createUploadUrl, is single-use and expires; a download link
 * is signed by the local driver for one key and expires, and an expired,
 * tampered or unsigned one is answered the 404 a missing key gets, before
 * the disk is touched. Only a File's own blobs are served
 * (`files/<org id>/…`), never a staged upload.
 *
 * Unlike the skill lane, both directions stream: a File may be 500 MB, so
 * the upload goes to disk through the slot registry's byte-capped pipe and
 * the download is piped from disk. Both renderers live beside the
 * dispatch, so the URL shapes and the handler cannot drift apart.
 *
 * Proven by __tests__/transfer.test.ts (both protocol stacks' shape, over
 * the real slots and signer) and the File conformance suite.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  contentDispositionAttachment,
  LOCAL_DOWNLOAD_QUERY_PARAM,
} from "../../artifactstorage/artifact-storage.js";
import type { DownloadUrlSigner } from "../../artifactstorage/url-signer.js";
import type { Logger } from "../../boot/logger.js";
import { FILE_TRANSFER_PATH_PREFIX } from "../../transport/constants.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../../transport/lanes.js";
import {
  SizeMismatchError,
  SlotConsumedError,
  SlotUnknownError,
} from "../skill/transfer/slots.js";
import type { UploadSlots } from "../skill/transfer/slots.js";
import { stagingKeyOf } from "./blobs.js";
import { BLOB_KEY_PREFIX, STAGING_KEY_PREFIX } from "./constants.js";

const UPLOADS_SEGMENT = "/uploads/";

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** The URL a reference's bytes are PUT to, against the lane's public base. */
export function fileUploadUrl(baseUrl: string, ref: string): string {
  return `${trimTrailingSlash(baseUrl)}${FILE_TRANSFER_PATH_PREFIX}${UPLOADS_SEGMENT}${ref}`;
}

/**
 * The serve URL the local File driver signs its links under, so a link it
 * mints (`${serveUrl}/<segment-encoded key>?exp=…&sig=…`) is exactly the
 * GET route below.
 */
export function fileTransferServeUrl(baseUrl: string): string {
  return `${trimTrailingSlash(baseUrl)}${FILE_TRANSFER_PATH_PREFIX}`;
}

export interface FileTransferLaneOptions {
  /** The File slot registry, staging under `root`. */
  readonly slots: UploadSlots;
  /** The local File driver's root: a key K lives at <root>/<K>. */
  readonly root: string;
  /** The signer the local File driver mints its links with. */
  readonly signer: DownloadUrlSigner;
  readonly logger: Logger;
}

export function newFileTransferLane(options: FileTransferLaneOptions): LaneHandler {
  const { slots, root, signer, logger } = options;
  return (request: LaneRequest, response: LaneResponse): void => {
    const url = request.url ?? "";
    const queryStart = url.indexOf("?");
    const pathOnly = queryStart === -1 ? url : url.slice(0, queryStart);
    const query = new URLSearchParams(queryStart === -1 ? "" : url.slice(queryStart + 1));
    if (!pathOnly.startsWith(FILE_TRANSFER_PATH_PREFIX)) {
      writeText(response, 404, "404 page not found");
      return;
    }
    const rest = pathOnly.slice(FILE_TRANSFER_PATH_PREFIX.length);

    // The lane router is synchronous; the handlers run detached, and the
    // terminal catch keeps a vanished client's write failure from becoming
    // an unhandled rejection.
    const logDetachedFailure = (arm: string) => (error: unknown) => {
      logger.error(`file transfer lane ${arm} handler failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    };

    if (rest.startsWith(UPLOADS_SEGMENT)) {
      handleUpload(request, response, slots, rest.slice(UPLOADS_SEGMENT.length), logger).catch(
        logDetachedFailure("upload"),
      );
      return;
    }
    handleDownload(request, response, root, signer, rest.replace(/^\//, ""), query, logger).catch(
      logDetachedFailure("download"),
    );
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
  // One answer for malformed, unknown and expired, so a caller cannot probe
  // which references were once valid.
  const unknown = () =>
    writeText(response, 404, "upload reference unknown or expired — request a new upload URL");
  const key = stagingKeyOf(ref);
  if (key === undefined) {
    unknown();
    return;
  }
  try {
    await slots.receive(key, request);
    response.statusCode = 204;
    response.end();
  } catch (error) {
    if (error instanceof SlotUnknownError) {
      unknown();
    } else if (error instanceof SlotConsumedError) {
      writeText(response, 409, "upload reference already used — request a new upload URL");
    } else if (error instanceof SizeMismatchError) {
      writeText(response, 400, `${error.message} — the upload must match the size given to createUploadUrl`);
    } else {
      // Never the reference: it is the capability, usable until it expires.
      logger.error("file upload failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      writeText(response, 500, "failed to stage upload");
    }
  }
}

async function handleDownload(
  request: LaneRequest,
  response: LaneResponse,
  root: string,
  signer: DownloadUrlSigner,
  encodedKey: string,
  query: URLSearchParams,
  logger: Logger,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    writeText(response, 405, "method not allowed");
    return;
  }
  const notFound = () => writeText(response, 404, "404 page not found");
  let key: string;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    notFound();
    return;
  }
  // A live signature first: nothing below runs for a link the server did
  // not mint, so a refusal says nothing about what exists.
  if (!signer.verify(key, query)) {
    notFound();
    return;
  }
  if (!key.startsWith(BLOB_KEY_PREFIX) || key.startsWith(STAGING_KEY_PREFIX)) {
    notFound();
    return;
  }
  const base = path.resolve(root);
  const filePath = path.resolve(base, key);
  if (!filePath.startsWith(base + path.sep)) {
    notFound();
    return;
  }
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      notFound();
      return;
    }
    size = info.size;
  } catch {
    notFound();
    return;
  }
  response.setHeader("Content-Length", String(size));
  // The filename rides the signed query, so the disposition cannot be
  // changed without breaking the signature.
  const downloadName = query.get(LOCAL_DOWNLOAD_QUERY_PARAM) ?? "";
  if (downloadName !== "") {
    response.setHeader("Content-Disposition", contentDispositionAttachment(downloadName));
  }
  response.statusCode = 200;
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    logger.error("file download stream failed", { key, error: error.message });
    response.destroy();
  });
  stream.pipe(response);
}

/** A plain-text answer with a trailing newline, as the skill lane writes. */
function writeText(response: LaneResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(`${body}\n`);
}
