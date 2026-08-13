"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/theme";
import { ModelSelector } from "../models/ModelSelector.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link FollowUpInput}. */
export interface FollowUpInputProps {
  /** Called when the user submits a message. */
  readonly onSubmit: (message: string, modelName?: string) => void;
  /** Shows loading indicator on send button. */
  readonly isSubmitting?: boolean;
  /** Disables the entire input (e.g., while an execution streams). */
  readonly disabled?: boolean;
  /** Show model selector in the input bar. Default: true. */
  readonly showModelSelector?: boolean;
  /** Initial model ID for the selector. */
  readonly defaultModelId?: string;
  /** Called when the user changes the selected model. */
  readonly onModelChange?: (modelId: string) => void;
  /** Placeholder text for the textarea. Default: "Reply...". */
  readonly placeholder?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const MAX_TEXTAREA_HEIGHT = 240;

/**
 * Embeddable input bar for continuing a conversation within a session.
 *
 * Composes a self-resizing textarea with an optional {@link ModelSelector}
 * and a send button. Designed as a drop-in companion to
 * {@link MessageThread} — platform builders wire them together via
 * {@link useSessionConversation} or manually.
 *
 * Uses `<div>` instead of `<form>` so it can be embedded inside host
 * application forms without nesting violations.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @deprecated Use {@link SessionComposer} instead. `SessionComposer`
 * unifies the launcher and follow-up input into a single component
 * with integrated workspace editing and extensible toolbar. This
 * component will be removed in a future release.
 *
 * @example
 * ```tsx
 * // Before (deprecated):
 * <FollowUpInput
 *   onSubmit={(msg, model) => conv.sendFollowUp(msg, { modelName: model })}
 *   disabled={!conv.canSendFollowUp}
 *   isSubmitting={conv.isSending}
 * />
 *
 * // After:
 * <SessionComposer
 *   onSubmit={(msg, model) => conv.sendFollowUp(msg, { modelName: model })}
 *   disabled={!conv.canSendFollowUp}
 *   isSubmitting={conv.isSending}
 *   workspace={workspace}
 * />
 * ```
 */
export function FollowUpInput({
  onSubmit,
  isSubmitting = false,
  disabled = false,
  showModelSelector = true,
  defaultModelId,
  onModelChange,
  placeholder = "Reply\u2026",
  className,
}: FollowUpInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const [modelId, setModelId] = useState<string | undefined>(defaultModelId);
  const prevDisabledRef = useRef(disabled);

  const isDisabled = disabled || isSubmitting;
  const canSubmit = message.trim().length > 0 && !isDisabled;

  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || isDisabled) return;

    onSubmit(trimmed, modelId);
    setMessage("");

    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  }, [message, modelId, isDisabled, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleModelChange = useCallback(
    (id: string) => {
      setModelId(id);
      onModelChange?.(id);
    },
    [onModelChange],
  );

  return (
    <div
      role="form"
      aria-label="Send follow-up message"
      className={cn(
        "stg:shrink-0 stg:px-4 stg:py-3",
        className,
      )}
    >
      <div
        className={cn(
          "stg:rounded-xl stg:border stg:border-border stg:bg-card stg:shadow-sm",
          "stg:focus-within:ring-2 stg:focus-within:ring-ring",
          isDisabled && "stg:opacity-50",
        )}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          rows={1}
          className="stg:block stg:w-full stg:resize-none stg:bg-transparent stg:px-4 stg:pt-3 stg:pb-2 stg:text-sm stg:text-foreground stg:placeholder:text-muted-foreground stg:focus:outline-none stg:disabled:cursor-not-allowed"
        />

        <div className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:border-t stg:border-border-muted stg:px-3 stg:py-2">
          <div className="stg:flex stg:items-center stg:gap-2">
            {showModelSelector && (
              <ModelSelector
                value={modelId}
                onValueChange={handleModelChange}
                disabled={isDisabled}
              />
            )}
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="stg:flex stg:h-8 stg:w-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-lg stg:bg-primary stg:text-primary-foreground stg:transition-colors stg:hover:bg-primary-hover stg:disabled:pointer-events-none stg:disabled:opacity-40"
            aria-label="Send message"
          >
            {isSubmitting ? <SpinnerIcon /> : <ArrowUpIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 12V4M4 7l4-4 4 4" />
    </svg>
  );
}

