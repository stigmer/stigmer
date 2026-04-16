import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Props for {@link TodoList}. */
export interface TodoListProps {
  /** Map of todo item IDs to their current state, as provided by the execution status. */
  readonly todos: { readonly [key: string]: TodoItem };
}

const STATUS_SORT_ORDER: ReadonlyMap<TodoStatus, number> = new Map([
  [TodoStatus.TODO_IN_PROGRESS, 0],
  [TodoStatus.TODO_PENDING, 1],
  [TodoStatus.TODO_COMPLETED, 2],
  [TodoStatus.TODO_CANCELLED, 3],
]);

const STATUS_DISPLAY: Record<number, { glyph: string; color: string }> = {
  [TodoStatus.TODO_PENDING]: { glyph: "○", color: "gray" },
  [TodoStatus.TODO_IN_PROGRESS]: { glyph: "●", color: "cyan" },
  [TodoStatus.TODO_COMPLETED]: { glyph: "✓", color: "green" },
  [TodoStatus.TODO_CANCELLED]: { glyph: "⊘", color: "gray" },
};

/**
 * Renders a sorted checklist of todo items in the terminal.
 *
 * Items are sorted by activity: in-progress first, then pending,
 * completed, and cancelled. Terminal equivalent of the web SDK's
 * TodoList component.
 */
export function TodoList({ todos }: TodoListProps) {
  const sortedTodos = useMemo(() => {
    const items = Object.values(todos);
    if (items.length === 0) return [];
    return items
      .slice()
      .sort(
        (a, b) =>
          (STATUS_SORT_ORDER.get(a.status) ?? 4) -
          (STATUS_SORT_ORDER.get(b.status) ?? 4),
      );
  }, [todos]);

  if (sortedTodos.length === 0) return null;

  const completed = sortedTodos.filter(
    (t) => t.status === TodoStatus.TODO_COMPLETED,
  ).length;

  return (
    <Box flexDirection="column">
      <Box gap={1} marginBottom={1}>
        <Text dimColor bold>Tasks</Text>
        <Text dimColor>({completed}/{sortedTodos.length})</Text>
      </Box>
      {sortedTodos.map((item) => {
        const display = STATUS_DISPLAY[item.status] ?? { glyph: "·", color: "gray" };
        const isCancelled = item.status === TodoStatus.TODO_CANCELLED;
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
