// The terminal decision for a tool use that waits for a person: the tool, its
// intent and sanitized arguments, why it asked, and three answers — Approve,
// Approve all of its class for the rest of the turn, or Deny with an optional
// reason the agent reads. The answer goes to the session (`confirmToolUse`,
// `grantPermission`) through the caller.
import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  resolveToolKind,
  describeApprovalPolicySource,
  hookApproveAllLabel,
  type ToolUse,
} from "@stigmer/client";
import {
  extractShellIntentFromPreview,
  type ToolUseAnswer,
} from "@stigmer/react-sdk/headless";

/** Props for {@link ApprovalPrompt}. */
export interface ApprovalPromptProps {
  /** The tool use that waits; its `ask` says why and carries the sanitized preview. */
  readonly toolUse: ToolUse;
  /** Called with the person's answer (and, for a deny, the reason they typed, if any). */
  readonly onAnswer: (answer: ToolUseAnswer, denyMessage?: string) => void;
  /** Disables input while an answer is in flight. */
  readonly isSubmitting?: boolean;
  /**
   * Whether this prompt owns the keyboard. Defaults to `true`. When `false` the
   * prompt renders inert (no `useInput`, no selection cursor, options dimmed) so
   * exactly one decision surface is interactive at a time.
   *
   * This is the terminal's single-active-decision-surface rule: stdin is
   * delivered to *every* mounted `useInput`, so several live `ApprovalPrompt`s
   * would each consume the same keystroke and settle at once. The caller
   * ({@link MessageThread}) marks only the first waiting tool use active; the
   * file-review prompt in turn yields to any waiting one
   * (`FileReviewPrompt.isActive = asks.length === 0` in `SessionView`), so the
   * order is: first ask → else the file-review prompt.
   */
  readonly isActive?: boolean;
}

interface ActionOption {
  readonly label: string;
  readonly answer: ToolUseAnswer;
  readonly color: string;
  readonly shortcut: string;
}

/**
 * Builds the truthful "Approve all" option label for a tool use's grant class —
 * the terminal mirror of the React card's buildApproveAllLabel.
 *
 * A grant is scoped to ONE class: when a hook asked, that hook's asks on that
 * one tool (`hookApproveAllLabel`); otherwise the MCP server for an MCP tool,
 * or the approval category (write/delete/shell), where FILE_WRITE and
 * FILE_EDIT collapse to one "file edits" class exactly as the runner's
 * toolApprovalCategory collapses them. The label names that class so it never
 * implies a broader bypass.
 */
function buildApproveAllLabel(toolUse: ToolUse): string {
  const { mcpServerName } = toolUse;
  if (toolUse.ask?.policySource === "hook") {
    return hookApproveAllLabel(hookLeaseSubject(toolUse), toolUse.ask?.policyHook ?? "");
  }
  if (mcpServerName) {
    return `Approve all ${mcpServerName} tools`;
  }
  switch (resolveToolKind(toolUse)) {
    case "shell":
      return "Approve all shell commands";
    case "file_delete":
      return "Approve all file deletions";
    case "file_write":
    case "file_edit":
      return "Approve all file edits";
    default:
      return "Approve all of this kind";
  }
}

/** What a hook grant covers, in words: one tool's calls, so a write and an edit stay apart. */
function hookLeaseSubject(toolUse: ToolUse): string {
  if (toolUse.mcpServerName) return `${toolUse.name} calls`;
  switch (resolveToolKind(toolUse)) {
    case "shell":
      return "shell commands";
    case "file_delete":
      return "file deletions";
    case "file_write":
      return "file writes";
    case "file_edit":
      return "file edits";
    default:
      return `${toolUse.name} calls`;
  }
}

/**
 * HITL approval prompt for a tool use that waits for a person.
 *
 * Displays the tool, its intent and sanitized arguments, then presents
 * Approve / Approve all / Deny, navigable via arrow keys or shortcut keys
 * (y/a/n). Enter confirms the highlighted option. Approve all (a) grants the
 * call's CLASS for the rest of the turn (its MCP server, or its file edit /
 * delete / shell category) — other classes keep asking; the label names that
 * class. Deny (n) opens a one-line reason the agent reads: Enter sends it
 * (empty sends none), Esc goes back.
 */
export function ApprovalPrompt({
  toolUse,
  onAnswer,
  isSubmitting = false,
  isActive = true,
}: ApprovalPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  const options = useMemo<readonly ActionOption[]>(
    () => [
      { label: "Approve", answer: "allow", color: "green", shortcut: "y" },
      { label: buildApproveAllLabel(toolUse), answer: "grant", color: "green", shortcut: "a" },
      { label: "Deny", answer: "deny", color: "red", shortcut: "n" },
    ],
    [toolUse],
  );

  const choose = (option: ActionOption): void => {
    if (option.answer === "deny") {
      setDenying(true);
      return;
    }
    onAnswer(option.answer);
  };

  useInput(
    (input, key) => {
      if (denying) {
        if (key.escape) {
          setDenying(false);
          setReason("");
        }
        return;
      }
      if (key.upArrow || key.leftArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : options.length - 1));
      } else if (key.downArrow || key.rightArrow) {
        setSelectedIndex((i) => (i < options.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        choose(options[selectedIndex]!);
      } else {
        const match = options.find((o) => o.shortcut === input.toLowerCase());
        if (match) choose(match);
      }
    },
    { isActive: isActive && !isSubmitting },
  );

  const ask = toolUse.ask;
  const argsPreview = ask?.argsPreview ?? "";
  const toolLabel = toolUse.mcpServerName
    ? `${toolUse.mcpServerName}/${toolUse.name}`
    : toolUse.name;

  // Why-gated: the rule that asked (the ask's policy source). Mirrors the
  // React card's gate-reason line so the terminal explains the gate at parity.
  const gateReason = describeApprovalPolicySource(ask?.policySource ?? "", ask?.policyHook ?? "");

  // Model-authored shell intent (stigmer#276), mirroring the React card's
  // header treatment: supplementary context only — the command in the Args
  // line stays foregrounded, because it is the content being approved.
  const intent = extractShellIntentFromPreview(toolUse.name, argsPreview, toolUse.mcpServerName);

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="round"
      borderColor="yellow"
    >
      <Text color="yellow" bold>
        ⚠ Approval required
      </Text>

      <Box paddingLeft={2} marginTop={1} flexDirection="column">
        <Box gap={1}>
          <Text dimColor>Tool:</Text>
          <Text bold>{toolLabel}</Text>
        </Box>
        {intent && (
          <Box gap={1}>
            <Text dimColor>Intent:</Text>
            <Text wrap="truncate-end">{intent}</Text>
          </Box>
        )}
        {argsPreview && (
          <Box gap={1}>
            <Text dimColor>Args:</Text>
            <Text wrap="truncate-end">{argsPreview}</Text>
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

      {denying ? (
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Box gap={1}>
            <Text color="red">Deny — reason (optional):</Text>
            <TextInput
              value={reason}
              onChange={setReason}
              onSubmit={(value) => {
                const trimmed = value.trim();
                onAnswer("deny", trimmed === "" ? undefined : trimmed);
              }}
              focus={isActive && !isSubmitting}
            />
          </Box>
          <Text dimColor>Enter to deny · Esc back</Text>
        </Box>
      ) : (
        <Box gap={2} marginTop={1} paddingLeft={2}>
          {options.map((opt, idx) => {
            // When inactive, no option is selected and all read dim — the
            // active prompt's highlight is the cue for which ask owns the
            // keyboard.
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
      )}

      {isSubmitting && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>Submitting...</Text>
        </Box>
      )}
    </Box>
  );
}
