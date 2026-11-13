/**
 * Shared fixture for the SessionViewer wiring tests that ask whether a
 * reader may undo a turn's edits: a finished turn that edited one file its
 * review still holds undecided, and a renderer that draws the outcome the
 * viewer hands its (probed) thread for a turn, so a test can look for the
 * per-file "Undo" button the viewer passes only to whoever decides, on the
 * newest turn.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FileReviewSet, Turn } from "@stigmer/client";
import { samples } from "../../../test";

/** A completed turn (`runId`) that edited `src/a.ts`, its review holding the file undecided as change set `cs-{runId}`. */
export function undecidedTurn(runId: string): Turn {
  const set: FileReviewSet = {
    changeSetId: `cs-${runId}`,
    runId,
    aggregateDigest: `agg-${runId}`,
    files: [
      {
        fileChangeId: `${runId}:a.ts`,
        path: "src/a.ts",
        previousPath: "",
        change: "modified",
        digest: `d-${runId}`,
        linesAdded: 2,
        linesRemoved: 1,
        reviewable: "complete",
        state: "undecided",
        decidedBy: "",
      },
    ],
    decisions: [],
    reconciles: [],
    undecided: true,
    processedAt: "",
  };
  const turn = samples.turn({ runId, tools: [{ name: "edit_file", input: { path: "/workspace/src/a.ts" }, result: "1 edit applied" }] });
  return { ...turn, fileReview: [set] };
}

/**
 * Draws what the viewer's thread would draw at the end of `turn`: the
 * `turnOutcome` render prop of the last props the thread probe captured.
 */
export function renderOutcomeOf(threadProps: Readonly<Record<string, unknown>>, turn: Turn): ReturnType<typeof render> {
  const draw = threadProps.turnOutcome as (turn: Turn) => ReactNode;
  return render(<>{draw(turn)}</>);
}
