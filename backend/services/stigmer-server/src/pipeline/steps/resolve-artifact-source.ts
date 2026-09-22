/**
 * ResolveArtifactSource — materialises the archive bytes of a push-shaped
 * request from whichever source it carries: inline bytes pass through; an
 * upload reference is consumed HERE, which retires the single-use
 * reference whatever happens downstream. Proto validation has already
 * guaranteed exactly one source. Downstream steps read the bytes from the
 * context key and never touch the request's fields, so the two sources
 * are indistinguishable past this point.
 *
 * Skills carried this step alone (the Go ResolveArtifactSource port);
 * plugins are pushed the same two ways over the same staging port (one
 * upload surface, as boot/compose.ts wires it), so the step lives here
 * and each kind names its lane-absent sentence and the request fields it
 * reads. The staging port (domain/skill/transfer/staging.ts) hides which
 * blob driver holds the bytes: the step never sees a slot or a bucket.
 *
 * The unusable-reference arm is INVALID_ARGUMENT, not a server fault: an
 * unknown, expired, already consumed, or never-uploaded reference all mean
 * the client must re-mint and re-upload. Any other failure reading the
 * staged bytes is the driver's — an infrastructure fault the executor
 * answers as a sanitized Internal, never dressed as the client's mistake.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { SlotUnknownError } from "../../domain/skill/transfer/slots.js";
import type { ArchiveStaging } from "../../domain/skill/transfer/staging.js";
import { failedPreconditionError, invalidArgumentError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";

/** Where the resolved bytes ride for every downstream step. */
export const ARTIFACT_BYTES_KEY = "pushArtifactBytes";

export interface ArtifactSourceBinding<Desc extends DescMessage> {
  /** The request's two sources; exactly one is set by proto validation. */
  source(input: MessageShape<Desc>): {
    readonly artifact: Uint8Array;
    readonly artifactUploadRef: string;
  };
  /** The FailedPrecondition copy when no lane is configured; each kind pins its own. */
  readonly laneNotConfigured: string;
}

export function newResolveArtifactSourceStep<Desc extends DescMessage>(
  staging: ArchiveStaging | undefined,
  binding: ArtifactSourceBinding<Desc>,
): PipelineStep<Desc> {
  return {
    name: "ResolveArtifactSource",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const { artifact, artifactUploadRef } = binding.source(ctx.input);
      if (artifactUploadRef === "") {
        ctx.set(ARTIFACT_BYTES_KEY, artifact);
        return;
      }
      if (staging === undefined) {
        throw failedPreconditionError(binding.laneNotConfigured);
      }
      let data: Uint8Array;
      try {
        data = await staging.consume(artifactUploadRef);
      } catch (error) {
        if (error instanceof SlotUnknownError) {
          throw invalidArgumentError(
            `artifact_upload_ref not usable: ${error.message} — request a new upload URL via createArtifactUploadUrl`,
          );
        }
        throw error;
      }
      ctx.set(ARTIFACT_BYTES_KEY, data);
    },
  };
}
