"use client";

import { useContext } from "react";
import { create } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { GetArtifactContentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import { StigmerContext } from "../context.js";
import { useFetch } from "../internal/useFetch.js";

/**
 * Request cap for artifact-backed review payloads.
 *
 * Matches the artifact store's 50MB creation limit
 * (`CreateArtifactInput.content` max_len), so a promoted payload can
 * never legitimately exceed this. Unlike preview flows, a review
 * renderer needs the complete payload — a truncated JSON document
 * would not even parse — so we request the full artifact rather than
 * the server's 512KB preview default.
 */
const REVIEW_PAYLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** Return value of {@link useReviewPayload}. */
export interface UseReviewPayloadReturn {
  /**
   * The materialized review payload: the inline value when the gate
   * carried it directly, or the fetched-and-parsed artifact content when
   * it was artifact-backed. `null` while loading, on error, or when the
   * gate has no payload at all.
   */
  readonly payload: JsonValue | null;
  /** `true` while an artifact-backed payload fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from a failed artifact fetch or parse, or `null`. */
  readonly error: Error | null;
  /** Re-fetch an artifact-backed payload after a failure. */
  readonly refetch: () => void;
}

/**
 * Behavior hook that materializes a human_input gate's review payload.
 *
 * The `approval_requested` event carries the payload in one of two forms
 * (mutually exclusive): inline JSON for small payloads, or an artifact
 * reference for payloads that exceeded the runner's promotion threshold.
 * This hook collapses the difference — consumers (custom review renderers,
 * the built-in approval card) always receive plain JSON plus loading and
 * error states, and never deal with artifact plumbing.
 *
 * Artifact content is read through `stigmer.artifact.getContent`, which
 * proxies bytes through the Stigmer API — embedded SDK consumers on
 * third-party origins avoid the CORS exposure of presigned URLs.
 *
 * Inline payloads resolve synchronously: `isLoading` is `false` and
 * `payload` is available on first render.
 *
 * @param inlinePayload - Inline payload from `TaskDetailApproval.payload`,
 *   or `null`.
 * @param payloadArtifactId - Artifact reference from
 *   `TaskDetailApproval.payloadArtifactId`, or `null`.
 */
export function useReviewPayload(
  inlinePayload: JsonValue | null,
  payloadArtifactId: string | null,
): UseReviewPayloadReturn {
  // Nullable on purpose: gates without an artifact-backed payload (no
  // payload, or an inline one) must keep working outside StigmerProvider,
  // as the approval surfaces always have. The client is a requirement of
  // the artifact fetch, not of the hook — enforced below with a
  // descriptive error (DD-006) only when a fetch is actually needed.
  const stigmer = useContext(StigmerContext);

  const { data, isLoading, error, refetch } = useFetch<JsonValue | null>(
    payloadArtifactId
      ? async () => {
          if (!stigmer) {
            throw new Error(
              "This gate's review payload is artifact-backed and needs a " +
              "Stigmer client to fetch. Wrap your component tree with " +
              "<StigmerProvider client={stigmerClient}>.",
            );
          }
          const response = await stigmer.artifact.getContent(
            create(GetArtifactContentRequestSchema, {
              artifactId: payloadArtifactId,
              maxBytes: BigInt(REVIEW_PAYLOAD_MAX_BYTES),
            }),
          );
          // Defensive: cannot happen while the promotion path and this cap
          // both honor the 50MB artifact limit, but a truncated JSON body
          // must fail loudly rather than parse into partial review material.
          if (response.truncated) {
            throw new Error(
              `Review payload artifact ${payloadArtifactId} exceeds the ` +
              `${REVIEW_PAYLOAD_MAX_BYTES} byte limit and was truncated`,
            );
          }
          const text = new TextDecoder().decode(response.content);
          return JSON.parse(text) as JsonValue;
        }
      : null,
    [payloadArtifactId, stigmer],
    null,
  );

  if (!payloadArtifactId) {
    return {
      payload: inlinePayload,
      isLoading: false,
      error: null,
      refetch,
    };
  }

  return { payload: data, isLoading, error, refetch };
}
