"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

/** Options for {@link useComposer}. */
export interface UseComposerOptions {
  /** Called with the trimmed message when the user submits. */
  readonly onSubmit: (message: string) => void;
  /** Prevents submission and disables the textarea. */
  readonly disabled?: boolean;
  /**
   * Maximum height (px) before the textarea scrolls instead of growing.
   * @default 240
   */
  readonly maxHeight?: number;
  /** Auto-focus the textarea when `disabled` transitions from true to false. */
  readonly autoFocusOnEnable?: boolean;
}

/** Return value of {@link useComposer}. */
export interface UseComposerReturn {
  /** Current message text. */
  readonly message: string;
  /** Replace the current message text. */
  readonly setMessage: (value: string) => void;
  /** Ref to attach to the `<textarea>` element. */
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Spread-ready props for the `<textarea>` element.
   *
   * Includes `ref`, `value`, `onChange`, `onKeyDown`, and `disabled`.
   * Consumers can override individual props by spreading first and
   * then specifying overrides.
   */
  readonly textareaProps: {
    /** Ref to the underlying `<textarea>` element. */
    readonly ref: RefObject<HTMLTextAreaElement | null>;
    /** Current message text bound to the textarea. */
    readonly value: string;
    /** Change handler that updates message state and triggers auto-resize. */
    readonly onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    /** Key handler that submits on Enter and allows Shift+Enter for newlines. */
    readonly onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    /** Whether the textarea is disabled (prevents typing and submission). */
    readonly disabled: boolean;
  };
  /** Whether the current message is non-empty and the input is not disabled. */
  readonly canSubmit: boolean;
  /** Programmatically submit the current message. No-op if `canSubmit` is false. */
  readonly submit: () => void;
  /** Clear the message and reset textarea height. */
  readonly clear: () => void;
}

/**
 * Headless behavior hook for a self-resizing, Enter-to-submit textarea.
 *
 * Encapsulates the common behavior shared across all Stigmer composer
 * surfaces (session launcher, follow-up input, and future variants):
 *
 * - Auto-resizing textarea up to a configurable max height
 * - Enter to submit, Shift+Enter for newline
 * - Disabled state management
 * - Auto-focus when transitioning from disabled to enabled
 *
 * Platform builders who want custom composer UI use this hook directly.
 * The {@link SessionComposer} styled component uses it internally.
 *
 * @example
 * ```tsx
 * function CustomInput({ onSend }: { onSend: (msg: string) => void }) {
 *   const composer = useComposer({ onSubmit: onSend });
 *
 *   return (
 *     <div>
 *       <textarea {...composer.textareaProps} rows={2} />
 *       <button onClick={composer.submit} disabled={!composer.canSubmit}>
 *         Send
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useComposer({
  onSubmit,
  disabled = false,
  maxHeight = 240,
  autoFocusOnEnable = true,
}: UseComposerOptions): UseComposerReturn {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const prevDisabledRef = useRef(disabled);

  const canSubmit = message.trim().length > 0 && !disabled;

  useEffect(() => {
    if (autoFocusOnEnable && prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled, autoFocusOnEnable]);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  }, []);

  const clear = useCallback(() => {
    setMessage("");
    resetHeight();
  }, [resetHeight]);

  const submit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    clear();
  }, [message, disabled, onSubmit, clear]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);
      resize();
    },
    [resize],
  );

  const textareaProps = {
    ref: textareaRef,
    value: message,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    disabled,
  } as const;

  return {
    message,
    setMessage,
    textareaRef,
    textareaProps,
    canSubmit,
    submit,
    clear,
  };
}
