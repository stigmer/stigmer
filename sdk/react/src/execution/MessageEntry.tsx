"use client";

import { memo, useState } from "react";
import { Streamdown } from "streamdown";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS } from "../internal/markdown-components";
import { useRenderTracer } from "../internal/dev";

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
 * - `MESSAGE_AI` — markdown-rendered via Streamdown with block-level
 *   memoization and streaming-aware incomplete-syntax healing
 * - `MESSAGE_THINKING` — collapsible thinking block with subdued styling,
 *   collapsed by default showing a brief summary
 * - `MESSAGE_SYSTEM` — small muted text
 * - `MESSAGE_TOOL` / `UNSPECIFIED` — renders nothing (tool results are
 *   consumed by {@link ToolCallGroup})
 *
 * Wrapped in `React.memo` — structural sharing (T04) guarantees that
 * unchanged messages keep the same object reference, so completed
 * messages skip re-renders entirely during streaming.
 *
 * Purely presentational — no data fetching, no state.
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <MessageEntry message={agentMessage} />
 * ```
 */
export const MessageEntry = memo(function MessageEntry({
  message,
  className,
}: MessageEntryProps) {
  useRenderTracer("MessageEntry", {
    messageType: message.type,
    contentLength: message.content.length,
    isStreaming: message.isStreaming,
  });

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
    case MessageType.MESSAGE_THINKING:
      return (
        <ThinkingMessage
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
});

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
  useRenderTracer("AiMessage", { contentLength: content.length, isStreaming });

  return (
    <div
      role="article"
      aria-label="AI response"
      aria-busy={isStreaming}
      className={cn("px-4 py-3", className)}
    >
      <div className="stgm-prose">
        <Streamdown
          components={MARKDOWN_COMPONENTS}
          isAnimating={isStreaming}
          caret="block"
        >
          {content}
        </Streamdown>
      </div>
    </div>
  );
}

const THINKING_PREVIEW_LENGTH = 80;

function ThinkingMessage({
  content,
  isStreaming,
  className,
}: {
  content: string;
  isStreaming: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = content.trim().length > 0;

  if (!hasContent && !isStreaming) return null;

  const preview = content.length > THINKING_PREVIEW_LENGTH
    ? content.slice(0, THINKING_PREVIEW_LENGTH).trimEnd() + "..."
    : content;

  return (
    <div
      role="article"
      aria-label="Model thinking"
      className={cn("px-4 py-1.5", className)}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground transition-colors",
          "hover:text-foreground cursor-pointer",
        )}
      >
        <ThinkingIcon isStreaming={isStreaming} />
        <span className="min-w-0 truncate">
          {isStreaming && !hasContent
            ? "Thinking..."
            : expanded
              ? "Thinking"
              : preview}
        </span>
        {hasContent && <ChevronIcon expanded={expanded} />}
      </button>

      {expanded && hasContent && (
        <div className="mt-1.5 border-l-2 border-muted-foreground/20 pl-3">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {content}
            {isStreaming && (
              <span
                className="inline-block w-[2px] h-[0.8em] bg-muted-foreground align-text-bottom animate-pulse ml-0.5"
                aria-hidden="true"
              />
            )}
          </p>
        </div>
      )}
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

function ThinkingIcon({ isStreaming }: { isStreaming: boolean }) {
  if (isStreaming) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="shrink-0 animate-spin"
        aria-hidden="true"
      >
        <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="3.5" />
      <path d="M4.5 9.5C4.5 8.5 5 8 6 8s1.5.5 1.5 1.5" />
      <circle cx="5" cy="4.5" r="0.5" fill="currentColor" />
      <circle cx="7" cy="4.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 transition-transform duration-150",
        expanded && "rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
