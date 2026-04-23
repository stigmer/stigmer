"use client";

import Markdown from "react-markdown";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS } from "../internal/markdown-components";

/** Props for {@link MessageEntry}. */
export interface MessageEntryProps {
  /** The agent message to render. */
  readonly message: AgentMessage;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a single message in the conversation thread.
 *
 * - `MESSAGE_HUMAN` — plain text with muted background
 * - `MESSAGE_AI` — markdown-rendered via `react-markdown` + `remark-gfm`,
 *   with a blinking cursor while streaming
 * - `MESSAGE_SYSTEM` — small muted text
 * - `MESSAGE_TOOL` / `UNSPECIFIED` — renders nothing (tool results are
 *   consumed by {@link ToolCallGroup} in SP4)
 *
 * Purely presentational — no data fetching, no state.
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <MessageEntry message={agentMessage} />
 * ```
 */
export function MessageEntry({ message, className }: MessageEntryProps) {
  switch (message.type) {
    case MessageType.MESSAGE_HUMAN:
      return <HumanMessage content={message.content} className={className} />;
    case MessageType.MESSAGE_AI:
      return (
        <AiMessage
          content={message.content}
          isStreaming={message.isStreaming}
          className={className}
        />
      );
    case MessageType.MESSAGE_SYSTEM:
      return <SystemMessage content={message.content} className={className} />;
    default:
      return null;
  }
}

function HumanMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      role="article"
      aria-label="User message"
      className={cn("ms-[20%] rounded-lg bg-muted-subtle px-4 py-3", className)}
    >
      <p className="text-sm text-foreground whitespace-pre-wrap">{content}</p>
    </div>
  );
}

function AiMessage({
  content,
  isStreaming,
  className,
}: {
  content: string;
  isStreaming: boolean;
  className?: string;
}) {
  return (
    <div
      role="article"
      aria-label="AI response"
      aria-busy={isStreaming}
      className={cn("px-4 py-3", className)}
    >
      <div className="stgm-prose">
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {content}
        </Markdown>
        {isStreaming && (
          <span
            className="inline-block w-[2px] h-[1em] bg-foreground align-text-bottom animate-pulse ml-0.5"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

function SystemMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      role="article"
      aria-label="System message"
      className={cn("px-4 py-2", className)}
    >
      <p className="text-xs text-muted-foreground italic">{content}</p>
    </div>
  );
}

