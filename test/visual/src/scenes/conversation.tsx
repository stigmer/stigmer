// The scene around the thread: the review dock the composer carries while a
// turn's file edits wait for a decision. The composer itself is drawn where
// people meet it, in the launcher and the session scenes.
import { FileReviewDock } from "@stigmer/react-sdk";
import { conversationOf, scenarios } from "@stigmer/react-sdk/test";
import type { Drawing } from "./drawing.ts";

function inert(): void {}

/** The dock over the `file-review` state's undecided set. */
export function fileReviewDockScene(): Drawing {
  const conversation = conversationOf(scenarios["file-review"]);
  return {
    render: () => (
      <FileReviewDock
        fileReviewSets={conversation.fileReviewSets}
        captures={conversation.fileChangeCaptures}
        onSubmit={inert}
        submittingDecisionKeys={conversation.submittingFileDecisionKeys}
        decisionErrors={conversation.fileDecisionErrors}
      />
    ),
  };
}
