// The thread's scenes: the conversation in each state of the scenario
// catalogue, drawn as the console's session view draws it. A state still
// loading draws the skeleton the session view shows; every other state draws
// `MessageThread` with the handlers the console gives an owner, each inert,
// so a waiting approval shows its decision and a failed turn its retry.
import { MessageThread, ThreadSkeleton } from "@stigmer/react-sdk";
import { conversationOf, scenarios } from "@stigmer/react-sdk/test";
import type { Preset, ThreadState } from "../catalog.ts";
import type { Drawing } from "./drawing.ts";

function inert(): void {}

/** The thread in `state`, in the default look or in `preset`. */
export function threadScene(state: ThreadState, preset?: Preset): Drawing {
  const conversation = conversationOf(scenarios[state]);
  return {
    preset,
    render: () =>
      conversation.isLoading ? (
        <ThreadSkeleton />
      ) : (
        <MessageThread
          turns={conversation.turns}
          runs={conversation.runs}
          queued={conversation.queued}
          pendingUserMessage={conversation.pendingUserMessage}
          pendingFiles={conversation.pendingFiles}
          onRetrySend={inert}
          onRetryRun={inert}
          onAnswerToolUse={inert}
          answeringToolUseIds={conversation.answeringToolUseIds}
          answerErrors={conversation.answerErrors}
          onStopBackgroundCommand={inert}
          stoppingBackgroundToolUseIds={conversation.stoppingBackgroundToolUseIds}
          stopBackgroundErrors={conversation.stopBackgroundErrors}
          showFileReviewRecords
          onEditMessage={conversation.isStoppable ? inert : undefined}
          resources={conversation.resources}
          org={conversation.org}
          contentColumn="center"
        />
      ),
  };
}
