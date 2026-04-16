import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";

/** Props for {@link SubAgentBlock}. */
export interface SubAgentBlockProps {
  /** The sub-agent execution data. */
  readonly subAgent: SubAgentExecution;
  /** Whether this block starts expanded. */
  readonly defaultExpanded?: boolean;
  /** Whether this component can receive keyboard focus for toggling. */
  readonly isFocused?: boolean;
}

const STATUS_GLYPHS: Record<number, { glyph: string; color: string }> = {
  [SubAgentStatus.SUB_AGENT_IN_PROGRESS]: { glyph: "⟳", color: "cyan" },
  [SubAgentStatus.SUB_AGENT_COMPLETED]: { glyph: "✓", color: "green" },
  [SubAgentStatus.SUB_AGENT_FAILED]: { glyph: "✗", color: "red" },
  [SubAgentStatus.SUB_AGENT_PENDING]: { glyph: "○", color: "gray" },
  [SubAgentStatus.SUB_AGENT_CANCELLED]: { glyph: "⊘", color: "yellow" },
};

function statusDisplay(status: SubAgentStatus): { glyph: string; color: string } {
  return STATUS_GLYPHS[status] ?? { glyph: "·", color: "gray" };
}

function formatDuration(startedAt: string, completedAt: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Renders a sub-agent execution as a collapsible block in the terminal.
 *
 * Shows a summary line with status glyph, name/subject, and duration.
 * When expanded, renders the sub-agent's internal message thread using
 * the same MessageEntry and ToolCallGroup components as the main thread.
 */
export function SubAgentBlock({
  subAgent,
  defaultExpanded = false,
  isFocused = false,
}: SubAgentBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useInput(
    (input, key) => {
      if (key.return || input === " ") {
        setExpanded((e) => !e);
      }
    },
    { isActive: isFocused },
  );

  const { glyph, color } = statusDisplay(subAgent.status);
  const label = subAgent.subject || subAgent.name || "Sub-agent";
  const duration = formatDuration(subAgent.startedAt, subAgent.completedAt);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Text color={color}>{glyph}</Text>
        <Text bold color="magenta">↳</Text>
        <Text bold>{label}</Text>
        {duration && <Text dimColor>({duration})</Text>}
        <Text dimColor>{expanded ? "▾" : "▸"}</Text>
      </Box>

      {expanded && (
        <Box flexDirection="column" paddingLeft={3} marginTop={1}>
          {subAgent.input && (
            <Box marginBottom={1}>
              <Text dimColor italic wrap="truncate-end">
                Task: {subAgent.input.length > 120
                  ? subAgent.input.slice(0, 120) + "…"
                  : subAgent.input}
              </Text>
            </Box>
          )}

          {renderSubAgentMessages(subAgent)}

          {subAgent.error && (
            <Box marginTop={1}>
              <Text color="red">Error: {subAgent.error}</Text>
            </Box>
          )}

          {subAgent.output && subAgent.status === SubAgentStatus.SUB_AGENT_COMPLETED && (
            <Box marginTop={1}>
              <Text dimColor>Result: </Text>
              <Text wrap="truncate-end">
                {subAgent.output.length > 200
                  ? subAgent.output.slice(0, 200) + "…"
                  : subAgent.output}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function renderSubAgentMessages(subAgent: SubAgentExecution): React.ReactNode {
  const messages = subAgent.messages ?? [];
  if (messages.length === 0) return null;

  const elements: React.ReactNode[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === MessageType.MESSAGE_TOOL) continue;

    const isEmptyAi =
      msg.type === MessageType.MESSAGE_AI && !msg.content.trim();

    if (!isEmptyAi) {
      elements.push(
        <Box key={`sub-m${i}`} marginBottom={1}>
          <MessageEntry message={msg} />
        </Box>,
      );
    }

    if (msg.type === MessageType.MESSAGE_AI && msg.toolCalls.length > 0) {
      elements.push(
        <Box key={`sub-m${i}-tc`} marginBottom={1}>
          <ToolCallGroup toolCalls={msg.toolCalls} />
        </Box>,
      );
    }
  }

  return <>{elements}</>;
}
