import React from "react";
import { Text } from "ink";

/**
 * Shared presentational atoms for the terminal file-review surfaces — the single
 * source for the `+N −M` line stat, so the decision prompt, the settled record,
 * and the mid-run progress bar can never drift in how they render a file's (or a
 * set's) magnitude. The terminal analogue of `@stigmer/react`'s `FileReviewAtoms`.
 *
 * The change-kind marker is deliberately NOT here: the terminal renders kind via
 * the pure `kindLetter` helper (in `file-review.ts`), already shared across every
 * surface. The web needs a `FileKindBadge` component because its marker carries
 * per-kind color tokens and a11y labels; a plain letter needs neither.
 */

/**
 * The `+N −M` stat for one file (or a whole set), in the diff colour vocabulary.
 * Renders nothing when both counts are zero — the honest signal that no count
 * exists (binary or secret-withheld changes, or records captured before the
 * counts were stamped) — rather than a misleading `+0 -0`, matching the web
 * `FileLineStats` contract.
 */
export function FileLineStats({
  linesAdded,
  linesRemoved,
}: {
  readonly linesAdded: number;
  readonly linesRemoved: number;
}) {
  if (linesAdded === 0 && linesRemoved === 0) return null;
  return (
    <Text>
      <Text color="green">+{linesAdded}</Text>
      <Text color="red"> -{linesRemoved}</Text>
    </Text>
  );
}
