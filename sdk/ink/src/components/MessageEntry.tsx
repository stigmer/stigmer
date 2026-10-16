// One message of the terminal conversation: a person's message, the agent's
// message (markdown rendered to ANSI), or a platform note, from the session's
// fold. Thinking is not rendered in the terminal.
import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ThreadMessage } from "@stigmer/react-sdk";
import { renderMarkdown } from "../markdown.js";

/** Props for {@link MessageEntry}. */
export interface MessageEntryProps {
  /** The message to render. */
  readonly message: ThreadMessage;
}

/**
 * Renders a single message in the terminal conversation thread.
 *
 * - `user` — plain text prefixed with a "You" indicator
 * - `message` — the agent's markdown rendered to ANSI-styled terminal
 *   output, with a "Thinking..." indicator while it is still empty and live
 * - `note` — dimmed text
 * - `thinking` — renders nothing
 */
export function MessageEntry({ message }: MessageEntryProps) {
  switch (message.kind) {
    case "user":
      return <HumanMessage content={message.text} />;
    case "message":
      return <AiMessage content={message.text} isStreaming={message.live} />;
    case "note":
      return <SystemMessage content={message.text} />;
    case "thinking":
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
