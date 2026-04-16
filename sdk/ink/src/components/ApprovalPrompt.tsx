import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Props for {@link ApprovalPrompt}. */
export interface ApprovalPromptProps {
  /** The pending approval request to render. */
  readonly pendingApproval: PendingApproval;
  /** Called when the user selects an action. */
  readonly onSubmit: (action: ApprovalAction) => void;
  /** Disables input while an approval submission is in flight. */
  readonly isSubmitting?: boolean;
}

interface ActionOption {
  readonly label: string;
  readonly action: ApprovalAction;
  readonly color: string;
  readonly shortcut: string;
}

const OPTIONS: readonly ActionOption[] = [
  {
    label: "Approve",
    action: ApprovalAction.APPROVE,
    color: "green",
    shortcut: "y",
  },
  {
    label: "Reject",
    action: ApprovalAction.REJECT,
    color: "red",
    shortcut: "n",
  },
  {
    label: "Skip",
    action: ApprovalAction.SKIP,
    color: "yellow",
    shortcut: "s",
  },
];

/**
 * HITL approval prompt for tool call authorization.
 *
 * Displays the tool name and args preview, then presents
 * Approve/Reject/Skip options navigable via arrow keys or
 * shortcut keys (y/n/s). Press Enter to confirm the highlighted
 * selection.
 */
export function ApprovalPrompt({
  pendingApproval,
  onSubmit,
  isSubmitting = false,
}: ApprovalPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(
    (input, key) => {
      if (isSubmitting) return;

      if (key.upArrow || key.leftArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : OPTIONS.length - 1));
      } else if (key.downArrow || key.rightArrow) {
        setSelectedIndex((i) => (i < OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        onSubmit(OPTIONS[selectedIndex].action);
      } else {
        const shortcutMatch = OPTIONS.findIndex(
          (o) => o.shortcut === input.toLowerCase(),
        );
        if (shortcutMatch >= 0) {
          onSubmit(OPTIONS[shortcutMatch].action);
        }
      }
    },
  );

  const serverSlug = pendingApproval.mcpServerSlug;
  const toolLabel = serverSlug
    ? `${serverSlug}/${pendingApproval.toolName}`
    : pendingApproval.toolName;

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="round"
      borderColor="yellow"
    >
      <Box gap={1}>
        <Text color="yellow" bold>
          ⚠ Approval required
        </Text>
        {pendingApproval.fromSubAgent && (
          <Text dimColor>
            via {pendingApproval.subAgentSubject || pendingApproval.subAgentName}
          </Text>
        )}
      </Box>

      <Box paddingLeft={2} marginTop={1} flexDirection="column">
        <Box gap={1}>
          <Text dimColor>Tool:</Text>
          <Text bold>{toolLabel}</Text>
        </Box>
        {pendingApproval.argsPreview && (
          <Box gap={1}>
            <Text dimColor>Args:</Text>
            <Text wrap="truncate-end">{pendingApproval.argsPreview}</Text>
          </Box>
        )}
      </Box>

      <Box gap={2} marginTop={1} paddingLeft={2}>
        {OPTIONS.map((opt, idx) => (
          <Text
            key={opt.shortcut}
            color={idx === selectedIndex ? opt.color : undefined}
            dimColor={idx !== selectedIndex}
            bold={idx === selectedIndex}
          >
            {idx === selectedIndex ? "▸ " : "  "}
            [{opt.shortcut}] {opt.label}
          </Text>
        ))}
      </Box>

      {isSubmitting && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>Submitting...</Text>
        </Box>
      )}
    </Box>
  );
}
