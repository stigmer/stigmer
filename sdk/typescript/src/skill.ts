import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import {
  CreateSkillArtifactUploadUrlRequestSchema,
  PushSkillRequestSchema,
  type PushSkillRequest,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { isUnimplemented, StigmerError } from "./gen/errors.js";
import { SkillClient } from "./gen/skill.js";

/**
 * Largest artifact pushed inline in the gRPC request (#675). The server's
 * transport cap is 10MB for the WHOLE message, so the artifact leaves 64KB
 * of headroom for the request envelope (org, tag, provenance, framing).
 * Mirrors the Go SDK's maxInlineArtifactBytes.
 */
export const MAX_INLINE_ARTIFACT_BYTES = 10 * 1024 * 1024 - 64 * 1024;

/**
 * Skill client with transport-aware push routing (stigmer#675 / #701).
 *
 * The gRPC transport caps messages at 10MB while skills may be up to 100MB,
 * so `push` routes by size: small artifacts travel inline in the request
 * (one round trip, unchanged behavior), larger ones are staged over HTTP
 * via `createArtifactUploadUrl` — a capability URL, so no auth header —
 * and pushed by reference. Callers never see the mechanics: `push(req)`
 * simply works for any valid skill size.
 *
 * Every other method is the generated client's, inherited unchanged.
 */
export class RoutedSkillClient extends SkillClient {
  private readonly fetchImpl: typeof globalThis.fetch | undefined;

  /**
   * @param fetchImpl - Custom `fetch` for the staging PUT. Must be the same
   *   implementation the transport uses where the global one is restricted
   *   (the Tauri CSP/CORS case the `Stigmer.fetch` property documents).
   */
  constructor(transport: Transport, fetchImpl?: typeof globalThis.fetch) {
    super(transport);
    this.fetchImpl = fetchImpl;
  }

  /**
   * Push a skill, routing the artifact by size (see the class comment).
   *
   * A request that already carries an `artifactUploadRef` is passed through
   * untouched — the caller has done its own staging.
   */
  override async push(input: PushSkillRequest): Promise<Skill> {
    if (input.artifactUploadRef !== "" || input.artifact.length <= MAX_INLINE_ARTIFACT_BYTES) {
      return super.push(input);
    }
    return this.pushViaUploadUrl(input);
  }

  /**
   * Stage the artifact over HTTP and push by reference:
   * createArtifactUploadUrl → PUT bytes → push(artifactUploadRef).
   */
  private async pushViaUploadUrl(input: PushSkillRequest): Promise<Skill> {
    let minted;
    try {
      minted = await super.createArtifactUploadUrl(
        create(CreateSkillArtifactUploadUrlRequestSchema, {
          org: input.org,
          sizeBytes: BigInt(input.artifact.length),
        }),
      );
    } catch (err) {
      if (isUnimplemented(err)) {
        // Pre-transfer-lane server: without staging, an artifact this size
        // physically cannot travel. Say so instead of surfacing the raw
        // transport error (the failure mode #675 reported).
        throw new StigmerError(
          "unknown",
          `skill artifact is ${input.artifact.length} bytes, above the ~10MB gRPC message cap, ` +
            "and this server does not support the HTTP artifact transfer lane — " +
            "upgrade stigmer-server to push skills of this size",
          Code.Unimplemented,
          { cause: err },
        );
      }
      throw err;
    }

    await this.putArtifact(minted.url, input.artifact);

    // Same request, artifact traveling by reference instead of by value.
    const byRef = create(PushSkillRequestSchema, {
      ...input,
      artifact: new Uint8Array(0),
      artifactUploadRef: minted.artifactUploadRef,
    });
    return super.push(byRef);
  }

  /**
   * PUT the artifact ZIP to the staging URL. The URL is the credential
   * (capability semantics — a pre-signed R2 URL on cloud, the server's own
   * transfer lane on OSS), so no auth header is attached.
   */
  private async putArtifact(url: string, artifact: Uint8Array): Promise<void> {
    const doFetch = this.fetchImpl ?? globalThis.fetch;
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
        `skill artifact upload rejected with HTTP ${resp.status}${detail === "" ? "" : `: ${detail}`}`,
        Code.Unknown,
      );
    }
  }
}
