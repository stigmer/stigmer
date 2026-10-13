// The agent's to-do list in the terminal: a turn's to-dos from the session's
// fold (`Turn.todos`), sorted by activity, with a completed count.
import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Todo } from "@stigmer/sdk";

/** Props for {@link TodoList}. */
export interface TodoListProps {
  /** The turn's to-do items, as its fold holds them (`Turn.todos`). */
  readonly todos: readonly Todo[];
}

const STATUS_SORT_ORDER: Readonly<Record<Todo["status"], number>> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

const STATUS_DISPLAY: Readonly<Record<Todo["status"], { glyph: string; color: string }>> = {
  pending: { glyph: "○", color: "gray" },
  in_progress: { glyph: "●", color: "cyan" },
  completed: { glyph: "✓", color: "green" },
  cancelled: { glyph: "⊘", color: "gray" },
};

/**
 * Renders a sorted checklist of to-do items in the terminal.
 *
 * Items are sorted by activity: in-progress first, then pending,
 * completed, and cancelled. Terminal equivalent of the web SDK's
 * TodoList component.
 */
export function TodoList({ todos }: TodoListProps) {
  const sortedTodos = useMemo(
    () => todos.slice().sort((a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]),
    [todos],
  );

  if (sortedTodos.length === 0) return null;

  const completed = sortedTodos.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column">
      <Box gap={1} marginBottom={1}>
        <Text dimColor bold>Tasks</Text>
        <Text dimColor>({completed}/{sortedTodos.length})</Text>
      </Box>
      {sortedTodos.map((item) => {
        const display = STATUS_DISPLAY[item.status];
        const isCancelled = item.status === "cancelled";
        return (
          <Box key={item.id} gap={1} paddingLeft={1}>
            <Text color={display.color}>{display.glyph}</Text>
            <Text
              dimColor={isCancelled}
              strikethrough={isCancelled}
            >
              {item.content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
