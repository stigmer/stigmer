import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useSessionConversation } from "@stigmer/react";
import { MessageThread } from "../components/MessageThread.js";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { UsageWidget } from "../components/UsageWidget.js";
import { ExecutionProgress } from "../components/ExecutionProgress.js";

/** Props for {@link SessionView}. */
export interface SessionViewProps {
  /** Session ID to display and converse in. */
  readonly sessionId: string;
  /** Organization slug for creating follow-up executions. */
  readonly org: string;
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
export function SessionView({ sessionId, org }: SessionViewProps) {
  const conv = useSessionConversation(sessionId, org);

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

  if (conv.streamError) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="red" bold>
          Stream error
        </Text>
        <Text color="red">{conv.streamError.message}</Text>
        <Text dimColor>The stream will attempt to reconnect automatically.</Text>
      </Box>
    );
  }

  const allExecutions = [
    ...conv.completedExecutions,
    ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
  ];

  return (
    <Box flexDirection="column">
      {conv.activePhase && <ExecutionProgress phase={conv.activePhase} />}

      <MessageThread
        executions={conv.completedExecutions}
        activeStreamExecution={conv.activeStreamExecution}
        pendingUserMessage={conv.pendingUserMessage}
        onApprovalSubmit={conv.submitApproval}
        submittingApprovalIds={conv.submittingApprovalIds}
      />

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

      <FollowUpInput
        onSubmit={(message) => conv.sendFollowUp(message)}
        isSubmitting={conv.isSending}
        disabled={!conv.canSendFollowUp}
      />
    </Box>
  );
}
