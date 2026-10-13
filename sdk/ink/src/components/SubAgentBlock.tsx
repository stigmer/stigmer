// A sub-agent's thread as a collapsible terminal block: a summary line (its
// state, what it was asked, how long it took) and, expanded, its task, its
// messages and tool uses in the order it produced them, and its reply or
// error — the same entries the main thread renders.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { isTodoTool, type Thread, type ToolUse } from "@stigmer/sdk";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";

/** Props for {@link SubAgentBlock}. */
export interface SubAgentBlockProps {
  /** The sub-agent's thread, from the session's fold (`ToolUse.thread`). */
  readonly thread: Thread;
  /** What it was asked to do, in a few words (the `task` call's description). */
  readonly subject?: string;
  /** When it started (its `task` call's time). */
  readonly startedAt?: string;
  /** When it finished (its `task` call's result time); "" while it runs. */
  readonly completedAt?: string;
  /** Whether this block starts expanded. */
  readonly defaultExpanded?: boolean;
  /** Whether this component can receive keyboard focus for toggling. */
  readonly isFocused?: boolean;
}

const STATUS_GLYPHS: Record<Thread["state"], { glyph: string; color: string }> = {
  running: { glyph: "⟳", color: "cyan" },
  completed: { glyph: "✓", color: "green" },
  failed: { glyph: "✗", color: "red" },
  // Its turn ended before the sub-agent finished.
  stopped: { glyph: "⊘", color: "yellow" },
};

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
 * Renders a sub-agent's thread as a collapsible block in the terminal.
 *
 * Shows a summary line with status glyph, subject (or the agent's name), and
 * duration. When expanded, renders the thread's items using the same
 * MessageEntry and ToolCallGroup components as the main thread.
 */
export function SubAgentBlock({
  thread,
  subject = "",
  startedAt = "",
  completedAt = "",
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

  const { glyph, color } = STATUS_GLYPHS[thread.state];
  const label = subject || thread.agentName || "Sub-agent";
  const duration = formatDuration(startedAt, completedAt);

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
          {thread.input && (
            <Box marginBottom={1}>
              <Text dimColor italic wrap="truncate-end">
                Task: {thread.input.length > 120
                  ? thread.input.slice(0, 120) + "…"
                  : thread.input}
              </Text>
            </Box>
          )}

          {renderThreadItems(thread)}

          {thread.state === "failed" && thread.reply && (
            <Box marginTop={1}>
              <Text color="red">Error: {thread.reply}</Text>
            </Box>
          )}

          {thread.state === "completed" && thread.reply && (
            <Box marginTop={1}>
              <Text dimColor>Result: </Text>
              <Text wrap="truncate-end">
                {thread.reply.length > 200
                  ? thread.reply.slice(0, 200) + "…"
                  : thread.reply}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * A thread's items as entries: each message or note on its own, each run of
 * consecutive tool uses (internal to-do calls left out) as one group.
 */
function renderThreadItems(thread: Thread): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let group: ToolUse[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    elements.push(
      <Box key={`${group[0]!.id}-tc`} marginBottom={1}>
        <ToolCallGroup toolUses={group} />
      </Box>,
    );
    group = [];
  };
  for (const item of thread.items) {
    if (item.kind === "tool_use") {
      if (!isTodoTool(item.name)) group.push(item);
      continue;
    }
    flush();
    if ((item.kind === "message" && item.text.trim()) || item.kind === "note") {
      elements.push(
        <Box key={item.id} marginBottom={1}>
          <MessageEntry message={item} />
        </Box>,
      );
    }
  }
  flush();
  return <>{elements}</>;
}
