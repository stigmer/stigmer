import { create } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import {
  CreateSkillArtifactUploadUrlRequestSchema,
  PushSkillRequestSchema,
  type PushSkillRequest,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { pushRoutedArtifact } from "./artifact-routing.js";
import type { ArtifactRoute } from "./artifact-routing.js";
import { SkillClient } from "./gen/skill.js";

export { MAX_INLINE_ARTIFACT_BYTES } from "./artifact-routing.js";

/**
 * Skill client with transport-aware push routing (stigmer#675 / #701):
 * the skill binding of `artifact-routing.ts`, which holds the mechanism
 * (small artifacts inline, larger ones staged over HTTP via
 * `createArtifactUploadUrl` and pushed by reference). Callers never see
 * the mechanics: `push(req)` simply works for any valid skill size.
 *
 * Every other method is the generated client's, inherited unchanged.
 */
export class RoutedSkillClient extends SkillClient {
  private readonly fetchImpl: typeof globalThis.fetch | undefined;
  private readonly route: ArtifactRoute<PushSkillRequest, Skill>;

  /**
   * @param fetchImpl - Custom `fetch` for the staging PUT. Must be the same
   *   implementation the transport uses where the global one is restricted
   *   (the Tauri CSP/CORS case the `Stigmer.fetch` property documents).
   */
  constructor(transport: Transport, fetchImpl?: typeof globalThis.fetch) {
    super(transport);
    this.fetchImpl = fetchImpl;
    this.route = {
      noun: "skill",
      artifactOf: (request) => request.artifact,
      uploadRefOf: (request) => request.artifactUploadRef,
      orgOf: (request) => request.org,
      withUploadRef: (request, artifactUploadRef) =>
        create(PushSkillRequestSchema, {
          ...request,
          artifact: new Uint8Array(0),
          artifactUploadRef,
        }),
      mintUploadUrl: (org, sizeBytes) =>
        super.createArtifactUploadUrl(
          create(CreateSkillArtifactUploadUrlRequestSchema, { org, sizeBytes }),
        ),
      push: (request) => super.push(request),
    };
  }

  /** Push a skill, routing the artifact by size (see the class comment). */
  override push(input: PushSkillRequest): Promise<Skill> {
    return pushRoutedArtifact(this.route, input, this.fetchImpl);
  }
}
