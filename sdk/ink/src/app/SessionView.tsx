import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useSessionConversation, resolvedSubject, PENDING_SUBJECT } from "@stigmer/react";
import { MessageThread } from "../components/MessageThread.js";
import { TodoList } from "../components/TodoList.js";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { UsageWidget } from "../components/UsageWidget.js";
import { ExecutionProgress } from "../components/ExecutionProgress.js";

/** Interaction mode type used for follow-up executions. */
export type InteractionMode = "agent" | "plan";

/** Props for {@link SessionView}. */
export interface SessionViewProps {
  /** Session ID to display and converse in. */
  readonly sessionId: string;
  /** Organization slug for creating follow-up executions. */
  readonly org: string;
  /**
   * Initial interaction mode for follow-up executions.
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
 * `@stigmer/react` to manage the complete conversation lifecycle,
 * then renders the thread and input using Ink terminal components.
 *
 * This is the main composition component that platform builders
 * drop into their Ink apps for a complete agent conversation UI.
 *
 * @example
 * ```tsx
 * import { InkStigmerProvider, createNodeClient, SessionView } from "@stigmer/ink";
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

  const allExecutions = [
    ...conv.completedExecutions,
    ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
  ];

  const activeTodos = conv.activeStreamExecution?.status?.todos;

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

      {conv.streamError && (
        <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
          <Box gap={1}>
            <Text color="yellow" bold>Stream disconnected</Text>
            <Text dimColor>— reconnecting...</Text>
          </Box>
          <Text color="red" dimColor>{conv.streamError.message}</Text>
        </Box>
      )}

      {conv.activePhase != null && conv.activePhase !== 0 && (
        <ExecutionProgress phase={conv.activePhase} />
      )}

      <MessageThread
        executions={conv.completedExecutions}
        activeStreamExecution={conv.activeStreamExecution}
        pendingUserMessage={conv.pendingUserMessage}
        onApprovalSubmit={conv.submitApproval}
        submittingApprovalIds={conv.submittingApprovalIds}
        expandToolCalls={expandTools}
      />

      {activeTodos && Object.keys(activeTodos).length > 0 && (
        <Box marginTop={1} paddingLeft={1}>
          <TodoList todos={activeTodos} />
        </Box>
      )}

      {conv.approvalError && (
        <Box paddingLeft={1}>
          <Text color="red">
            Approval error: {conv.approvalError.message}
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

      <UsageWidget executions={allExecutions} />

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
