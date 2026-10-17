/**
 * The one place a person's rating becomes a score write: the SDK input
 * for a new rating and the update that changes an existing rating (its
 * thumbs and comment alone, on the score as read, with its etag). Both
 * hooks build their requests here, so the shape of a rating (its metric,
 * its source, the thumbs as the spec's `passed` value, an empty metadata
 * name the server fills with the score's id) is stated once.
 */
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Score, ScoreSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSource } from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import type { ScoreInput } from "@stigmer/client";
import { FEEDBACK_METRIC } from "./score-view.js";

/** A person's rating of one run. */
export interface RunRating {
  /** The run's organization (its `metadata.org`). */
  readonly org: string;
  /** The rated run's id. */
  readonly runId: string;
  /** `true` for thumbs up, `false` for thumbs down. */
  readonly passed: boolean;
  /** An optional one-line note, at most 500 characters. */
  readonly comment?: string;
}

/** The longest comment a rating carries. */
export const RATING_COMMENT_MAX_LENGTH = 500;

/** The input for a new rating. */
export function ratingCreateInput(rating: RunRating): ScoreInput {
  return {
    // Empty name: the server names an unnamed score by its own id, so two
    // people's ratings never share a slug.
    name: "",
    org: rating.org,
    runId: rating.runId,
    metric: FEEDBACK_METRIC,
    source: ScoreSource.human,
    passed: rating.passed,
    comment: rating.comment ?? "",
  };
}

/** The fields a change of a rating names. */
export const RATING_UPDATE_PATHS: ReadonlyArray<string> = ["spec.passed", "spec.comment"];

/** The update that changes an existing rating's thumbs and comment, and nothing else. */
export function ratingUpdate(
  existing: Score,
  change: { readonly passed: boolean; readonly comment?: string },
): { resource: MessageInitShape<typeof ScoreSchema>; paths: string[] } {
  return {
    resource: {
      metadata: { id: existing.metadata?.id ?? "", etag: existing.metadata?.etag ?? "" },
      spec: { value: { case: "passed", value: change.passed }, comment: change.comment ?? "" },
    },
    paths: [...RATING_UPDATE_PATHS],
  };
}
