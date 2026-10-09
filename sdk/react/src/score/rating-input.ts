/**
 * The one place a person's rating becomes a score write: the create input
 * for a new rating and the update input for a changed one. Both hooks
 * build their requests here, so the shape of a rating (its measure, its
 * source, an empty metadata name the server fills with the score's id)
 * is stated once.
 */
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { toScoreUpdateInput, type ScoreInput } from "@stigmer/sdk";

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

/** The create input for a new rating. */
export function ratingCreateInput(rating: RunRating): ScoreInput {
  return {
    // Empty: the server names an unnamed score by its own id, so two
    // people's ratings never share a slug.
    name: "",
    org: rating.org,
    runId: rating.runId,
    source: ScoreSource.human,
    passed: rating.passed,
    comment: rating.comment ?? "",
  };
}

/** The update input that changes an existing rating's thumbs and comment. */
export function ratingUpdateInput(
  existing: Score,
  change: { readonly passed: boolean; readonly comment?: string },
): ScoreInput {
  return {
    ...toScoreUpdateInput(existing),
    passed: change.passed,
    comment: change.comment ?? "",
  };
}
