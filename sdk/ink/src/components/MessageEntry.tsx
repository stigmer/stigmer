import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { renderMarkdown } from "../markdown.js";

/** Props for {@link MessageEntry}. */
export interface MessageEntryProps {
  /** The agent message to render. */
  readonly message: AgentMessage;
}

/**
 * Renders a single message in the terminal conversation thread.
 *
 * - `MESSAGE_HUMAN` — plain text prefixed with a "You" indicator
 * - `MESSAGE_AI` — markdown rendered to ANSI-styled terminal output,
 *   with a cursor indicator while streaming
 * - `MESSAGE_SYSTEM` — dimmed text
 * - `MESSAGE_TOOL` / `UNSPECIFIED` — renders nothing (tool results
 *   are handled by {@link ToolCallGroup})
 */
export function MessageEntry({ message }: MessageEntryProps) {
  switch (message.type) {
    case MessageType.MESSAGE_HUMAN:
      return <HumanMessage content={message.content} />;
    case MessageType.MESSAGE_AI:
      return (
        <AiMessage content={message.content} isStreaming={message.isStreaming} />
      );
    case MessageType.MESSAGE_SYSTEM:
      return <SystemMessage content={message.content} />;
    default:
      return null;
  }
}

function HumanMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold color="cyan">
        You
      </Text>
      <Text>{content}</Text>
    </Box>
  );
}

function AiMessage({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const rendered = useMemo(() => {
    if (!content.trim()) return "";
    return renderMarkdown(content);
  }, [content]);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold color="green">
        Agent
      </Text>
      {rendered ? <Text>{rendered}</Text> : null}
      {isStreaming && !rendered && <Text dimColor>Thinking...</Text>}
    </Box>
  );
}

function SystemMessage({ content }: { content: string }) {
  return (
    <Box paddingLeft={1}>
      <Text dimColor italic>
        {content}
      </Text>
    </Box>
  );
}
