import { Code } from "@connectrpc/connect";
import { isUnimplemented, StigmerError } from "./gen/errors.js";

/**
 * Largest artifact pushed inline in the gRPC request (#675). The server's
 * transport cap is 10MB for the WHOLE message, so the artifact leaves 64KB
 * of headroom for the request envelope (org, tag, provenance, framing).
 * Mirrors the Go SDK's maxInlineArtifactBytes.
 */
export const MAX_INLINE_ARTIFACT_BYTES = 10 * 1024 * 1024 - 64 * 1024;

/**
 * Transport-aware push routing for archive-shaped kinds (skills, plugins;
 * stigmer#675 / #701). The gRPC transport caps messages at 10MB while an
 * archive may be up to 100MB, so a push routes by size: a small archive
 * travels inline (one round trip), a larger one is staged over HTTP via
 * the kind's `createArtifactUploadUrl` — a capability URL, so no auth
 * header — and pushed by reference. Skills carried this alone; plugins
 * push the same two ways, so the routing lives here once and each kind
 * binds its request shape and its noun.
 */
export interface ArtifactRoute<Request, Response> {
  /** The noun in error copy: "skill", "plugin". */
  readonly noun: string;
  artifactOf(request: Request): Uint8Array;
  uploadRefOf(request: Request): string;
  orgOf(request: Request): string;
  /** The same request with the bytes replaced by a staged reference. */
  withUploadRef(request: Request, artifactUploadRef: string): Request;
  mintUploadUrl(
    org: string,
    sizeBytes: bigint,
  ): Promise<{ url: string; artifactUploadRef: string }>;
  push(request: Request): Promise<Response>;
}

/**
 * Push, routing the archive by size. A request that already carries an
 * upload reference is passed through untouched — the caller has done its
 * own staging.
 */
export async function pushRoutedArtifact<Request, Response>(
  route: ArtifactRoute<Request, Response>,
  input: Request,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<Response> {
  const artifact = route.artifactOf(input);
  if (
    route.uploadRefOf(input) !== "" ||
    artifact.length <= MAX_INLINE_ARTIFACT_BYTES
  ) {
    return route.push(input);
  }

  let minted;
  try {
    minted = await route.mintUploadUrl(
      route.orgOf(input),
      BigInt(artifact.length),
    );
  } catch (err) {
    if (isUnimplemented(err)) {
      // Pre-transfer-lane server: without staging, an artifact this size
      // physically cannot travel. Say so instead of surfacing the raw
      // transport error (the failure mode #675 reported).
      throw new StigmerError(
        "unknown",
        `${route.noun} artifact is ${artifact.length} bytes, above the ~10MB gRPC message cap, ` +
          "and this server does not support the HTTP artifact transfer lane — " +
          `upgrade stigmer-server to push ${route.noun}s of this size`,
        Code.Unimplemented,
        { cause: err },
      );
    }
    throw err;
  }

  await putArtifact(route.noun, minted.url, artifact, fetchImpl);
  return route.push(route.withUploadRef(input, minted.artifactUploadRef));
}

/**
 * PUT the archive to the staging URL. The URL is the credential
 * (capability semantics — a pre-signed R2 URL on cloud, the server's own
 * transfer lane on OSS), so no auth header is attached.
 */
async function putArtifact(
  noun: string,
  url: string,
  artifact: Uint8Array,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<void> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const resp = await doFetch(url, {
    method: "PUT",
    // Both DOM and undici accept an ArrayBufferView body at runtime; the
    // cast bridges TS 5.7's ArrayBufferLike generic, which BodyInit's
    // typing predates. A Blob/Buffer wrapper would copy up to 100MB for
    // nothing, and Buffer is Node-only while this client is isomorphic.
    body: artifact as unknown as RequestInit["body"],
    headers: { "content-type": "application/zip" },
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 512).trim();
    throw new StigmerError(
      "unknown",
      `${noun} artifact upload rejected with HTTP ${resp.status}${detail === "" ? "" : `: ${detail}`}`,
      Code.Unknown,
    );
  }
}
