"use client";

import { memo, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  type InteractionMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import {
  MARKDOWN_COMPONENTS,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";
import { InteractionModeBadge } from "./InteractionModeBadge.js";
import {
  MessageAttachments,
  type MessageAttachmentView,
} from "./MessageAttachments.js";
import { PlanDocumentMessage } from "./PlanDocumentMessage.js";
import { useRenderTracer } from "../internal/dev/index.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

/** Props for {@link MessageEntry}. */
export interface MessageEntryProps {
  /** The agent message to render. */
  readonly message: AgentMessage;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * When provided on a `MESSAGE_HUMAN` entry, a hover-revealed "Edit" button
   * appears on the bubble. Clicking it invokes this callback — the session
   * chat uses it to stop the in-flight turn and pre-fill the composer with
   * this message for editing. Ignored for non-human messages.
   */
  readonly onEdit?: () => void;
  /**
   * Renders a `MESSAGE_AI` entry as a first-class plan document
   * ({@link PlanDocumentMessage}) instead of a chat bubble. Set by the thread
   * builder only on the NO-ARTIFACT fallback path: a completed Plan turn that
   * never published `plan.md` (older executions, failed upload) keeps its
   * plan inline — the message is the only copy of the plan. A turn that
   * published the artifact collapses the message into the compact plan card
   * instead (the document lives in the panel's plan tab). Ignored for non-AI
   * messages.
   */
  readonly isPlanDocument?: boolean;
  /**
   * The turn's interaction mode, stamped by the thread builder on the
   * synthetic prompt bubble (`MESSAGE_HUMAN`). Renders the
   * {@link InteractionModeBadge} for non-default modes (a "Plan" pill), so
   * the transcript reads unambiguously after mode switches. Ignored for
   * non-human messages.
   */
  readonly interactionMode?: InteractionMode;
  /**
   * The turn's submitted attachments, stamped by the thread builder on
   * `MESSAGE_HUMAN` bubbles from the execution's `spec.attachments` (or the
   * pending submit context). Renders as a {@link MessageAttachments} row
   * above the prose. Ignored for non-human messages.
   *
   * A `MessageEntry` slot override that delegates to the built-in inherits
   * attachment rendering; one that ignores this prop renders text only.
   */
  readonly attachments?: readonly MessageAttachmentView[];
  /**
   * The execution the attachments belong to — enables their byte-backed
   * affordances (image previews, document downloads) via presigned URLs.
   * Absent on the optimistic pending bubble, where attachments render as
   * inert chips until the real execution record replaces it.
   */
  readonly executionId?: string;
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
  onEdit,
  isPlanDocument,
  interactionMode,
  attachments,
  executionId,
}: MessageEntryProps) {
  useRenderTracer("MessageEntry", {
    messageType: message.type,
    contentLength: message.content.length,
    isStreaming: message.isStreaming,
  });

  switch (message.type) {
    case MessageType.MESSAGE_HUMAN:
      return (
        <HumanMessage
          content={message.content}
          className={className}
          onEdit={onEdit}
          interactionMode={interactionMode}
          attachments={attachments}
          executionId={executionId}
        />
      );
    case MessageType.MESSAGE_AI:
      // A completed Plan turn's plan is a document, not a bubble. The flag is
      // only ever set on a settled message, so the streaming path is untouched.
      if (isPlanDocument) {
        return (
          <PlanDocumentMessage content={message.content} className={className} />
        );
      }
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
  onEdit,
  interactionMode,
  attachments,
  executionId,
}: {
  content: string;
  className?: string;
  onEdit?: () => void;
  interactionMode?: InteractionMode;
  attachments?: readonly MessageAttachmentView[];
  executionId?: string;
}) {
  return (
    <div
      role="article"
      aria-label="User message"
      className={cn(
        "stg:group stg:relative stg:ms-[20%] stg:rounded-lg stg:bg-muted-subtle stg:px-4 stg:py-3",
        className,
      )}
    >
      {/* The badge renders only for non-default modes (a "Plan" pill), so
          ordinary Agent turns carry no extra chrome. */}
      {interactionMode !== undefined && (
        <InteractionModeBadge mode={interactionMode} className="stg:mb-1.5" />
      )}
      {/* The evidence a file rode with this turn (#372) — above the prose,
          mirroring the composer's chips-above-input layout. */}
      {attachments && attachments.length > 0 && (
        <MessageAttachments
          attachments={attachments}
          executionId={executionId}
          className="stg:mb-2"
        />
      )}
      <p className="stg:text-sm stg:text-foreground stg:whitespace-pre-wrap">{content}</p>
      {/* The hover-revealed action cluster on the bubble's shoulder: copy is
          always offered (the message text is the content), edit only when the
          host wired the callback. */}
      <div className="stg:absolute stg:-top-2.5 stg:-right-2.5 stg:flex stg:gap-1">
        <CopyMessageButton text={content} variant="bubble" />
        {onEdit && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label="Edit message"
                  className={BUBBLE_ACTION_CLASSES}
                />
              }
            >
              <EditIcon />
            </TooltipTrigger>
            <TooltipContent side="top">Edit</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/**
 * The Build-from-plan turn's user entry: a compact pill in the user-turn
 * position (right-aligned, like the prompt bubble it replaces) carrying the
 * plan glyph and the turn's short label. Deliberately not editable — the
 * label is not user prose to rephrase; refining the plan happens in the plan
 * document, and the build is re-triggered from its card.
 */
function EditIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
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

  // A model that wraps its whole reply in a ```markdown fence (Plan-mode plans
  // most often) would otherwise render as one flat code block. Unwrap it here,
  // at the render seam, so the transcript stays faithful to what the agent sent.
  const markdown = useMemo(
    () => unwrapEnclosingMarkdownFence(content),
    [content],
  );

  return (
    <div
      role="article"
      aria-label="AI response"
      aria-busy={isStreaming}
      className={cn("stg:group stg:px-4 stg:py-3", className)}
    >
      <div className="stgm-prose">
        <Streamdown
          components={MARKDOWN_COMPONENTS}
          isAnimating={isStreaming}
          caret="block"
        >
          {markdown}
        </Streamdown>
      </div>
      {/* The quiet per-message actions row (issue #278). Height is reserved
          whenever it renders, so the hover reveal never shifts the prose; it
          appears only once the message settles — a streaming message's text
          is still changing, so a copy would race the content. Copies the
          display markdown (fence-unwrapped), i.e. what the reader sees. */}
      {!isStreaming && markdown.trim().length > 0 && (
        <div className="stg:mt-1 stg:flex stg:h-6 stg:items-center">
          <CopyMessageButton text={markdown} variant="quiet" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-message copy affordance (issue #278)
// ---------------------------------------------------------------------------

// The floating circular action on a human bubble's shoulder — shared by the
// copy and edit buttons so the cluster reads as one control family.
const BUBBLE_ACTION_CLASSES = cn(
  "stg:inline-flex stg:h-7 stg:w-7 stg:items-center stg:justify-center stg:rounded-full",
  "stg:border stg:border-border stg:bg-card stg:text-muted-foreground stg:shadow-sm stg:transition",
  "stg:hover:text-foreground stg:hover:bg-accent-hover",
  "stg:opacity-0 stg:group-hover:opacity-100 stg:focus-visible:opacity-100",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
);

// The quiet in-flow variant for AI prose: no border or fill, one contrast
// step below the reading text (`muted-foreground-subtle`, rising to
// `muted-foreground` on hover) — findable when wanted, invisible while
// reading. The same hover/focus reveal keeps both variants keyboard-reachable.
const QUIET_ACTION_CLASSES = cn(
  "stg:inline-flex stg:h-6 stg:w-6 stg:items-center stg:justify-center stg:rounded-md",
  "stg:text-muted-foreground-subtle stg:transition",
  "stg:hover:text-muted-foreground stg:hover:bg-accent-hover",
  "stg:opacity-0 stg:group-hover:opacity-100 stg:focus-visible:opacity-100",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
);

/**
 * The per-message copy control: writes the message's text to the clipboard
 * and flips to a check for the feedback window. `variant` selects the visual
 * home — `"bubble"` joins the human bubble's floating action cluster,
 * `"quiet"` sits in the AI message's reserved actions row.
 */
function CopyMessageButton({
  text,
  variant,
}: {
  text: string;
  variant: "bubble" | "quiet";
}) {
  const { copy, copied } = useCopyFeedback();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => void copy(text)}
            aria-label={copied ? "Copied" : "Copy message"}
            className={
              variant === "bubble" ? BUBBLE_ACTION_CLASSES : QUIET_ACTION_CLASSES
            }
          />
        }
      >
        {copied ? <CheckIcon /> : <CopyMessageIcon />}
      </TooltipTrigger>
      <TooltipContent side="top">{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

function CopyMessageIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
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
      className={cn("stg:px-4 stg:py-1.5", className)}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground stg:transition-colors",
          "stg:hover:text-foreground stg:cursor-pointer",
        )}
      >
        <ThinkingIcon isStreaming={isStreaming} />
        {/* Live reasoning carries the ambient-liveness sweep (stigmer#277) —
            the words themselves signal activity, not just the icon. */}
        <span className={cn("stg:min-w-0 stg:truncate", isStreaming && "stgm-shimmer-label")}>
          {isStreaming && !hasContent
            ? "Thinking..."
            : expanded
              ? "Thinking"
              : preview}
        </span>
        {hasContent && <ChevronIcon expanded={expanded} />}
      </button>

      {expanded && hasContent && (
        <div className="stg:mt-1.5 stg:border-l-2 stg:border-muted-foreground/20 stg:pl-3">
          <p className="stg:text-xs stg:text-muted-foreground stg:whitespace-pre-wrap stg:leading-relaxed">
            {content}
            {isStreaming && (
              <span
                className="stg:inline-block stg:w-[2px] stg:h-[0.8em] stg:bg-muted-foreground stg:align-text-bottom stg:animate-pulse stg:ml-0.5"
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
      className={cn("stg:px-4 stg:py-2", className)}
    >
      <p className="stg:text-xs stg:text-muted-foreground stg:italic">{content}</p>
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
        className="stg:shrink-0 stg:animate-spin"
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
      className="stg:shrink-0"
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
        "stg:shrink-0 stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
