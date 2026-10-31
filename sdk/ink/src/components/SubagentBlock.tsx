// A subagent's thread as a collapsible terminal block: a summary line (its
// state, what it was asked, how long it took) and, expanded, its task, its
// messages and tool uses in the order it produced them, and its reply or
// error — the same entries the main thread renders. The time reads as every
// terminal span does (`formatElapsed`, "2h 4m"), and only a running subagent
// counts to now.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { formatElapsed, isTodoTool, type Thread, type ToolUse } from "@stigmer/client";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { useRoles, type InkRole } from "../theme.js";

/** Props for {@link SubagentBlock}. */
export interface SubagentBlockProps {
  /** The subagent's thread, from the session's fold (`ToolUse.thread`). */
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

const STATUS_GLYPHS: Record<Thread["state"], { glyph: string; role: InkRole }> = {
  running: { glyph: "⟳", role: "accent" },
  completed: { glyph: "✓", role: "success" },
  failed: { glyph: "✗", role: "danger" },
  // Its turn ended before the subagent finished.
  stopped: { glyph: "⊘", role: "warning" },
};

/**
 * How long the subagent ran, by its state: a running one counts to now; a
 * finished one shows its span when both ends are known, and nothing
 * otherwise (a finished subagent never counts on to now).
 */
export function subagentDuration(state: Thread["state"], startedAt: string, completedAt: string, nowMs: number): string | null {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  const end = state === "running" ? nowMs : Date.parse(completedAt);
  if (Number.isNaN(end)) return null;
  return formatElapsed(end - start);
}

/**
 * Renders a subagent's thread as a collapsible block in the terminal.
 *
 * Shows a summary line with status glyph, subject (or the agent's name), and
 * duration. When expanded, renders the thread's items using the same
 * MessageEntry and ToolCallGroup components as the main thread.
 */
export function SubagentBlock({
  thread,
  subject = "",
  startedAt = "",
  completedAt = "",
  defaultExpanded = false,
  isFocused = false,
}: SubagentBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useInput(
    (input, key) => {
      if (key.return || input === " ") {
        setExpanded((e) => !e);
      }
    },
    { isActive: isFocused },
  );

  const role = useRoles();
  const { glyph, role: tone } = STATUS_GLYPHS[thread.state];
  const label = subject || thread.agentName || "Subagent";
  const duration = subagentDuration(thread.state, startedAt, completedAt, Date.now());

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Text {...role[tone]}>{glyph}</Text>
        <Text bold {...role.accent}>↳</Text>
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
              <Text {...role.danger}>Error: {thread.reply}</Text>
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
