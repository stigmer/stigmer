import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import type { Eval } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import {
  CreateEvalArtifactUploadUrlRequestSchema,
  PushEvalRequestSchema,
  type PushEvalRequest,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { pushRoutedArtifact } from "./artifact-routing.js";
import type { ArtifactRoute } from "./artifact-routing.js";
import { StigmerError } from "./gen/errors.js";
import { EvalClient } from "./gen/eval.js";
import type { ResourceRef } from "./gen/types.js";

/**
 * Eval client with transport-aware push routing: the eval binding of
 * `artifact-routing.ts`. An evals/ folder's archive travels inline when it
 * fits the gRPC message cap and is staged over HTTP via
 * `createArtifactUploadUrl` when it does not. The mint names the slug the
 * push names, because the server asks the same question of both: create
 * in the organization for a new eval, edit on the one the slug holds.
 * Every other method is the generated client's, inherited unchanged.
 */
export class RoutedEvalClient extends EvalClient {
  private readonly fetchImpl: typeof globalThis.fetch | undefined;
  private readonly route: ArtifactRoute<PushEvalRequest, Eval>;

  /**
   * @param fetchImpl - Custom `fetch` for the staging PUT. Must be the same
   *   implementation the transport uses where the global one is restricted
   *   (the Tauri CSP/CORS case the `Stigmer.fetch` property documents).
   */
  constructor(transport: Transport, fetchImpl?: typeof globalThis.fetch) {
    super(transport);
    this.fetchImpl = fetchImpl;
    this.route = {
      noun: "eval",
      artifactOf: (request) => request.artifact,
      uploadRefOf: (request) => request.artifactUploadRef,
      withUploadRef: (request, artifactUploadRef) =>
        create(PushEvalRequestSchema, {
          ...request,
          artifact: new Uint8Array(0),
          artifactUploadRef,
        }),
      mintUploadUrl: (request, sizeBytes) =>
        super.createArtifactUploadUrl(
          create(CreateEvalArtifactUploadUrlRequestSchema, {
            org: request.org,
            slug: request.slug,
            sizeBytes,
          }),
        ),
      push: (request) => super.push(request),
    };
  }

  /** Push an evals/ folder's archive, routing it by size (see the class comment). */
  override push(input: PushEvalRequest): Promise<Eval> {
    return pushRoutedArtifact(this.route, input, this.fetchImpl);
  }
}

/** One version of an eval as it was pushed: the archive and its digest. */
export interface DownloadedEvalArchive {
  readonly bytes: Uint8Array;
  /** SHA-256 of `bytes`, lowercase hex: the version's digest, checked. */
  readonly digest: string;
}

/** The two downloads `downloadEvalArchive` reads through. */
export type EvalArchiveReader = Pick<EvalClient, "download" | "getDownloadUrl">;

/**
 * Download one version of an eval: the reference's version picks it (none
 * is the current version, a tag or a digest an older one). The URL lane
 * comes first, since an archive may be above the gRPC message cap; a
 * server without the lane (UNIMPLEMENTED, or FAILED_PRECONDITION when it
 * is not configured) is read inline instead. The bytes are checked against
 * the digest the server names, so a truncated or substituted download is
 * refused rather than written.
 */
export async function downloadEvalArchive(
  client: EvalArchiveReader,
  ref: ResourceRef,
  fetchImpl?: typeof globalThis.fetch,
): Promise<DownloadedEvalArchive> {
  let bytes: Uint8Array;
  let digest: string;
  try {
    const minted = await client.getDownloadUrl(ref);
    digest = minted.digest;
    bytes = await fetchArchive(minted.url, fetchImpl);
  } catch (err) {
    if (!laneAbsent(err)) {
      throw err;
    }
    const inline = await client.download(ref);
    digest = inline.digest;
    bytes = inline.artifact;
  }
  const actual = await sha256Hex(bytes);
  if (actual !== digest) {
    throw new StigmerError(
      "unknown",
      `eval archive download does not match its digest: expected ${digest}, got ${actual} over ${bytes.length} bytes`,
      Code.DataLoss,
    );
  }
  return { bytes, digest };
}

/** Whether a getDownloadUrl failure means "this server has no URL lane", so the inline read applies. */
function laneAbsent(err: unknown): boolean {
  return (
    err instanceof StigmerError &&
    (err.connectCode === Code.Unimplemented || err.connectCode === Code.FailedPrecondition)
  );
}

/** GET the archive from its URL; the URL is the credential, so no auth header. */
async function fetchArchive(url: string, fetchImpl: typeof globalThis.fetch | undefined): Promise<Uint8Array> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const resp = await doFetch(url);
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 512).trim();
    throw new StigmerError(
      "unknown",
      `eval archive download failed with HTTP ${resp.status}${detail === "" ? "" : `: ${detail}`}`,
      Code.Unknown,
    );
  }
  return new Uint8Array(await resp.arrayBuffer());
}

/** Lowercase hex SHA-256, through WebCrypto so the helper runs in Node and browsers alike. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
