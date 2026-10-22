// The terminal session view: a session's conversation (its turns, read from
// the session's events) with the live turn's phase, to-dos and usage, the
// mid-turn file progress, the docked file-review decision, and the follow-up
// input with its agent/plan mode.
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  useSessionConversation,
  resolvedSubject,
  runPhaseOf,
  PENDING_SUBJECT,
} from "@stigmer/react-sdk";
import { MessageThread } from "../components/MessageThread.js";
import { TodoList } from "../components/TodoList.js";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { UsageWidget } from "../components/UsageWidget.js";
import { RunProgress } from "../components/RunProgress.js";
import { FileChangeProgressBar } from "../components/FileChangeProgressBar.js";
import { FileReviewPrompt } from "../components/FileReviewPrompt.js";

/** Interaction mode type used for follow-up runs. */
export type InteractionMode = "agent" | "plan";

/** Props for {@link SessionView}. */
export interface SessionViewProps {
  /** Session ID to display and converse in. */
  readonly sessionId: string;
  /** Organization slug for creating follow-up runs. */
  readonly org: string;
  /**
   * Initial interaction mode for follow-up runs.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   *
   * The user can toggle between modes with Ctrl+T during the session.
   * This prop sets the initial value; subsequent toggles are managed
   * as local state.
   */
  readonly mode?: InteractionMode;
}

/**
 * Full-featured session conversation view for the terminal.
 *
 * Uses the headless {@link useSessionConversation} hook from
 * `@stigmer/react-sdk` to manage the complete conversation lifecycle,
 * then renders the thread and input using Ink terminal components.
 *
 * This is the main composition component that platform builders
 * drop into their Ink apps for a complete agent conversation UI.
 *
 * @example
 * ```tsx
 * import { InkStigmerProvider, createNodeClient, SessionView } from "@stigmer/ink-ui";
 *
 * const client = createNodeClient({ baseUrl: "...", apiKey: "..." });
 *
 * render(
 *   <InkStigmerProvider client={client}>
 *     <SessionView sessionId="ses-xxx" org="my-org" />
 *   </InkStigmerProvider>
 * );
 * ```
 */
export function SessionView({ sessionId, org, mode }: SessionViewProps) {
  const conv = useSessionConversation(sessionId, org);
  const [expandTools, setExpandTools] = useState(false);
  const [activeMode, setActiveMode] = useState<InteractionMode>(mode ?? "agent");

  useEffect(() => {
    if (mode) setActiveMode(mode);
  }, [mode]);

  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setExpandTools((e) => !e);
    }
    if (key.ctrl && input === "t") {
      setActiveMode((m) => (m === "plan" ? "agent" : "plan"));
    }
  });

  if (conv.isLoading) {
    return (
      <Box gap={1} paddingLeft={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text>Loading session...</Text>
      </Box>
    );
  }

  if (conv.loadError) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="red" bold>
          Failed to load session
        </Text>
        <Text color="red">{conv.loadError.message}</Text>
      </Box>
    );
  }

  const activeTodos = conv.activeTurn?.todos ?? [];
  const reviewSet = conv.fileReviewSets[0];

  const subject = resolvedSubject(conv.session?.spec?.subject);

  return (
    <Box flexDirection="column">
      {subject && subject !== PENDING_SUBJECT && (
        <Box paddingLeft={1} marginBottom={1}>
          <Text dimColor bold>{subject}</Text>
        </Box>
      )}

      {conv.isConnecting && (
        <Box gap={1} paddingLeft={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor>Connecting to stream...</Text>
        </Box>
      )}

      {conv.isReconnecting && (
        <Box gap={1} paddingLeft={1}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text dimColor>Reconnecting...</Text>
        </Box>
      )}

      {conv.streamError && (
        <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
          <Text color="yellow" bold>Stream disconnected</Text>
          <Text color="red" dimColor>{conv.streamError.message}</Text>
        </Box>
      )}

      {conv.activePhase !== null && reviewSet === undefined && (
        // Suppressed while a set awaits review: review is not a phase of the
        // turn, so the phase would otherwise read as an active "Running"
        // spinner while the agent is idle awaiting the reviewer — the
        // FileReviewPrompt is the honest cue.
        <RunProgress phase={runPhaseOf(conv.activePhase)} />
      )}

      <MessageThread
        turns={conv.turns}
        runs={conv.runs}
        pendingUserMessage={conv.pendingUserMessage}
        queued={conv.queued}
        onAnswerToolUse={conv.answerToolUse}
        answeringToolUseIds={conv.answeringToolUseIds}
        expandToolCalls={expandTools}
        showFileReviewRecords
      />

      {activeTodos.length > 0 && (
        <Box marginTop={1} paddingLeft={1}>
          <TodoList todos={activeTodos} />
        </Box>
      )}

      {conv.answerError && (
        <Box paddingLeft={1}>
          <Text color="red">
            Approval error: {conv.answerError.message}
          </Text>
        </Box>
      )}

      {conv.sendError && (
        <Box paddingLeft={1}>
          <Text color="red">
            Send error: {conv.sendError.message}
          </Text>
        </Box>
      )}

      <UsageWidget runs={conv.runs} />

      {/* Mid-turn live capture: the transient "N files changing…" strip
          for a still-running turn, covering shell-made changes with no tool row.
          Mutually exclusive with the FileReviewPrompt below — progress shows
          while the turn captures, the prompt once its changes are offered — so
          it hands off cleanly when review opens. Non-interactive; the per-file
          list reuses the existing Ctrl+O expand toggle. */}
      <FileChangeProgressBar
        progress={conv.fileChangeProgress}
        expanded={expandTools}
      />

      {reviewSet && (
        <Box flexDirection="column">
          <FileReviewPrompt
            fileReviewSet={reviewSet}
            capture={conv.fileChangeCaptures.get(reviewSet.changeSetId) ?? null}
            onSubmit={conv.reviewFileChanges}
            submittingDecisionKeys={conv.submittingFileDecisionKeys}
            decisionErrors={conv.fileDecisionErrors}
            // Single active decision surface: yield to a tool use that waits.
            isActive={conv.asks.length === 0}
          />
          {conv.fileReviewSets.length > 1 && (
            <Box paddingLeft={2}>
              <Text dimColor>
                {conv.fileReviewSets.length - 1} more awaiting review
              </Text>
            </Box>
          )}
        </Box>
      )}

      {conv.fileReviewError && (
        <Box paddingLeft={1}>
          <Text color="red">
            File review error: {conv.fileReviewError.message}
          </Text>
        </Box>
      )}

      {conv.canSendFollowUp && (
        <Box paddingLeft={1}>
          <Text color={activeMode === "plan" ? "yellow" : "cyan"} dimColor>
            {activeMode === "plan"
              ? "Plan mode — read-only analysis, no file mutations"
              : "Agent mode — full tool access"}
          </Text>
        </Box>
      )}

      <FollowUpInput
        onSubmit={(message) =>
          conv.sendFollowUp(message, { interactionMode: activeMode })
        }
        isSubmitting={conv.isSending}
        disabled={!conv.canSendFollowUp}
        mode={activeMode}
      />
    </Box>
  );
}
