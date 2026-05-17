import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useSessionConversation, resolvedSubject, PENDING_SUBJECT } from "@stigmer/react";
import { MessageThread } from "../components/MessageThread.js";
import { TodoList } from "../components/TodoList.js";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { UsageWidget } from "../components/UsageWidget.js";
import { ExecutionProgress } from "../components/ExecutionProgress.js";

/** Props for {@link SessionView}. */
export interface SessionViewProps {
  /** Session ID to display and converse in. */
  readonly sessionId: string;
  /** Organization slug for creating follow-up executions. */
  readonly org: string;
  /**
   * Default interaction mode for follow-up executions.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   *
   * When set, all follow-up executions use this mode unless the user
   * overrides it (e.g., via a future mode picker widget).
   */
  readonly mode?: "agent" | "plan";
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

  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setExpandTools((e) => !e);
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
  const contextInfo = conv.activeStreamExecution?.status?.contextInfo;
  const summarizationCount = contextInfo?.summarizationEvents?.length ?? 0;

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

      {summarizationCount > 0 && (
        <Box paddingLeft={1} marginTop={1}>
          <Text dimColor>
            Context compacted ({summarizationCount} {summarizationCount === 1 ? "event" : "events"}, {Math.round(contextInfo!.utilizationPercent)}% utilization)
          </Text>
        </Box>
      )}

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

      {mode === "plan" && conv.canSendFollowUp && (
        <Box paddingLeft={1}>
          <Text color="yellow" dimColor>Plan mode — read-only analysis, no file mutations</Text>
        </Box>
      )}

      <FollowUpInput
        onSubmit={(message) =>
          conv.sendFollowUp(message, mode ? { interactionMode: mode } : undefined)
        }
        isSubmitting={conv.isSending}
        disabled={!conv.canSendFollowUp}
      />
    </Box>
  );
}
