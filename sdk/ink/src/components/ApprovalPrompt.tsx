import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ToolKind,
  resolveToolKindByName,
  describeApprovalPolicySource,
} from "@stigmer/sdk";

/** Props for {@link ApprovalPrompt}. */
export interface ApprovalPromptProps {
  /** The pending approval request to render. */
  readonly pendingApproval: PendingApproval;
  /** Called when the user selects an action. */
  readonly onSubmit: (action: ApprovalAction) => void;
  /** Disables input while an approval submission is in flight. */
  readonly isSubmitting?: boolean;
  /**
   * Whether this prompt owns the keyboard. Defaults to `true`. When `false` the
   * prompt renders inert (no `useInput`, no selection cursor, options dimmed) so
   * exactly one decision surface is interactive at a time.
   *
   * This is the terminal's single-active-decision-surface rule: stdin is
   * delivered to *every* mounted `useInput`, so several live `ApprovalPrompt`s
   * would each consume the same keystroke and settle at once. The caller
   * ({@link MessageThread}) marks only the first pending approval active; the
   * file-review prompt in turn yields to any pending approval
   * (`FileReviewPrompt.isActive = pendingApprovals.length === 0` in `SessionView`),
   * so the order is: first approval → else the file-review prompt.
   */
  readonly isActive?: boolean;
}

interface ActionOption {
  readonly label: string;
  readonly action: ApprovalAction;
  readonly color: string;
  readonly shortcut: string;
}

/**
 * Builds the truthful APPROVE_ALL option label for a pending approval's lease
 * class — the terminal mirror of the React card's buildApproveAllLabel.
 *
 * APPROVE_ALL grants a run-lifetime lease scoped to ONE class: the MCP server
 * for an MCP tool, otherwise the approval category (write/delete/shell), where
 * FILE_WRITE and FILE_EDIT collapse to one "file edits" class exactly as the
 * runner's toolApprovalCategory collapses them. The label names that class so it
 * never implies a broader, run-wide bypass.
 */
function buildApproveAllLabel(
  toolName: string,
  mcpServerSlug: string,
): string {
  if (mcpServerSlug) {
    return `Approve all ${mcpServerSlug} tools`;
  }
  switch (resolveToolKindByName(toolName, mcpServerSlug)) {
    case ToolKind.SHELL:
      return "Approve all shell commands";
    case ToolKind.FILE_DELETE:
      return "Approve all file deletions";
    case ToolKind.FILE_WRITE:
    case ToolKind.FILE_EDIT:
      return "Approve all file edits";
    default:
      return "Approve all of this kind";
  }
}

/**
 * HITL approval prompt for tool call authorization.
 *
 * Displays the tool name and args preview, then presents
 * Approve/Approve-all/Reject/Skip options navigable via arrow keys
 * or shortcut keys (y/a/n/s). Press Enter to confirm the highlighted
 * selection. The approve-all option (a) maps to APPROVE_ALL, which grants a
 * run-lifetime lease scoped to the clicked tool's CLASS (its MCP server, or its
 * file edit / delete / shell category) — other classes keep prompting. The
 * option label names that class so the scope is never a surprise.
 */
export function ApprovalPrompt({
  pendingApproval,
  onSubmit,
  isSubmitting = false,
  isActive = true,
}: ApprovalPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const options = useMemo<readonly ActionOption[]>(
    () => [
      {
        label: "Approve",
        action: ApprovalAction.APPROVE,
        color: "green",
        shortcut: "y",
      },
      {
        label: buildApproveAllLabel(
          pendingApproval.toolName,
          pendingApproval.mcpServerSlug,
        ),
        action: ApprovalAction.APPROVE_ALL,
        color: "green",
        shortcut: "a",
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
    ],
    [pendingApproval.toolName, pendingApproval.mcpServerSlug],
  );

  useInput(
    (input, key) => {
      if (isSubmitting) return;

      if (key.upArrow || key.leftArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : options.length - 1));
      } else if (key.downArrow || key.rightArrow) {
        setSelectedIndex((i) => (i < options.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        onSubmit(options[selectedIndex].action);
      } else {
        const shortcutMatch = options.findIndex(
          (o) => o.shortcut === input.toLowerCase(),
        );
        if (shortcutMatch >= 0) {
          onSubmit(options[shortcutMatch].action);
        }
      }
    },
    { isActive: isActive && !isSubmitting },
  );

  const serverSlug = pendingApproval.mcpServerSlug;
  const toolLabel = serverSlug
    ? `${serverSlug}/${pendingApproval.toolName}`
    : pendingApproval.toolName;

  // Why-gated: the authorization provenance the server projected onto the
  // PendingApproval. Mirrors the React card's gate-reason line so the terminal
  // surface explains the gate at parity. Empty for legacy executions.
  const gateReason = describeApprovalPolicySource(
    pendingApproval.approvalPolicySource,
  );

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
        {gateReason && (
          <Box gap={1}>
            <Text dimColor>Why:</Text>
            <Text dimColor italic>
              {gateReason}
            </Text>
          </Box>
        )}
      </Box>

      <Box gap={2} marginTop={1} paddingLeft={2}>
        {options.map((opt, idx) => {
          // When inactive, no option is selected and all read dim — the active
          // prompt's highlight (vs. these dimmed rows) is the cue for which
          // approval owns the keyboard, so no per-prompt hint is needed.
          const selected = isActive && idx === selectedIndex;
          return (
            <Text
              key={opt.shortcut}
              color={selected ? opt.color : undefined}
              dimColor={!selected}
              bold={selected}
            >
              {selected ? "▸ " : "  "}
              [{opt.shortcut}] {opt.label}
            </Text>
          );
        })}
      </Box>

      {isSubmitting && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>Submitting...</Text>
        </Box>
      )}
    </Box>
  );
}
