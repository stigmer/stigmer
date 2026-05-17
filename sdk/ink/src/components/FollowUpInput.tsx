import React, { useState } from "react";
import { Box, Text, useStdin } from "ink";
import TextInput from "ink-text-input";

/** Props for {@link FollowUpInput}. */
export interface FollowUpInputProps {
  /** Called when the user submits a message (Enter key). */
  readonly onSubmit: (message: string) => void;
  /** Shows a "sending" indicator and disables input. */
  readonly isSubmitting?: boolean;
  /** Disables the input entirely. */
  readonly disabled?: boolean;
  /** Placeholder text. Default: "Reply..." */
  readonly placeholder?: string;
  /** Current interaction mode. Shown in the shortcut hint line. */
  readonly mode?: "agent" | "plan";
}

/**
 * Terminal text input for sending follow-up messages in a session.
 *
 * Renders a single-line text input with a submit hint. Press Enter
 * to submit, Ctrl+C to exit the application.
 */
export function FollowUpInput({
  onSubmit,
  isSubmitting = false,
  disabled = false,
  placeholder = "Reply...",
  mode,
}: FollowUpInputProps) {
  const [value, setValue] = useState("");
  const { isRawModeSupported } = useStdin();
  const isDisabled = disabled || isSubmitting || !isRawModeSupported;

  const handleSubmit = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  if (isDisabled) {
    return (
      <Box paddingLeft={1} paddingTop={1}>
        <Text dimColor>
          {isSubmitting ? "Sending..." : placeholder}
        </Text>
      </Box>
    );
  }

  return (
    <Box paddingLeft={1} paddingTop={1} flexDirection="column">
      <Box gap={1}>
        <Text color="cyan" bold>
          ❯
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>
          Enter to send · Ctrl+T {mode === "plan" ? "agent" : "plan"} mode · Ctrl+C exit
        </Text>
      </Box>
    </Box>
  );
}
