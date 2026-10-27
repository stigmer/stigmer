// The scenes around the thread: the review dock the composer carries while a
// turn's file edits wait for a decision, and the composer itself.
import { FileReviewDock, FollowUpInput } from "@stigmer/react-sdk";
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

/** The composer, idle, sending, or disabled while a decision waits. */
export function composerScene(state: "idle" | "submitting" | "disabled"): Drawing {
  return {
    render: () => (
      <FollowUpInput onSubmit={inert} isSubmitting={state === "submitting"} disabled={state === "disabled"} />
    ),
  };
}
