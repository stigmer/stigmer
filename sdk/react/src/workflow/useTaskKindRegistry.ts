"use client";

import { useMemo } from "react";
import type { TaskKindDescriptor, TaskKindCategory } from "./types.js";
import { useTaskKindRegistryContext } from "./TaskKindRegistryContext.js";

/** Return value of {@link useTaskKindRegistry}. */
export interface UseTaskKindRegistryReturn {
  /** All registered task kind descriptors, one per WorkflowTaskKind. */
  readonly descriptors: readonly TaskKindDescriptor[];

  /**
   * Look up a single descriptor by its kind identifier.
   *
   * @example
   * ```ts
   * const llm = getByKind("llm_call");
   * // llm?.displayName === "LLM Call"
   * ```
   */
  readonly getByKind: (kind: string) => TaskKindDescriptor | undefined;

  /**
   * Retrieve the JSON Schema for a task kind's configuration.
   *
   * Returns the parsed JSON Schema object suitable for Monaco editor
   * validation or React JSON Schema Form (RJSF) rendering.
   *
   * @example
   * ```ts
   * const schema = getJsonSchema("llm_call");
   * // Pass to Monaco: monaco.languages.json.jsonDefaults.setDiagnosticsOptions(...)
   * ```
   */
  readonly getJsonSchema: (kind: string) => Record<string, unknown> | undefined;

  /**
   * Descriptors grouped by their functional category.
   *
   * Useful for rendering a categorized task palette where tasks are
   * organized into sections like "AI", "Control Flow", "Data", etc.
   *
   * @example
   * ```tsx
   * for (const [category, tasks] of categories) {
   *   // Render category header + task cards
   * }
   * ```
   */
  readonly categories: ReadonlyMap<TaskKindCategory, readonly TaskKindDescriptor[]>;

  /** `true` while the task kind registry is being fetched from the API. */
  readonly isLoading: boolean;

  /** Non-null if the API fetch failed. Descriptors will be empty in this case. */
  readonly error: Error | null;

  /** Retry fetching the registry. No-op while a fetch is in flight. */
  readonly refetch: () => void;
}

/**
 * Data hook that exposes the task kind registry with lookup and grouping helpers.
 *
 * Pure data layer — no rendering, no side effects. Platform builders
 * who want full control over rendering import this hook and build
 * their own UI (task palettes, form generators, validation).
 *
 * The registry data is fetched from the task kind registry API by
 * {@link StigmerProvider} and cached in context. During loading,
 * `isLoading` is `true` and `descriptors` is empty.
 *
 * @example
 * ```tsx
 * function TaskPalette() {
 *   const { categories, isLoading, error } = useTaskKindRegistry();
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return (
 *     <div>
 *       {Array.from(categories).map(([category, tasks]) => (
 *         <CategorySection key={category} label={category}>
 *           {tasks.map(task => (
 *             <TaskCard key={task.kind} descriptor={task} />
 *           ))}
 *         </CategorySection>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // YAML editor integration
 * function WorkflowEditor({ taskKind }: { taskKind: string }) {
 *   const { getJsonSchema } = useTaskKindRegistry();
 *   const schema = getJsonSchema(taskKind);
 *   // Pass schema to Monaco for autocomplete + validation
 * }
 * ```
 *
 * @since T04 (Task Schema Registry)
 */
export function useTaskKindRegistry(): UseTaskKindRegistryReturn {
  const { descriptors, isLoading, error, refetch } = useTaskKindRegistryContext();

  return useMemo(() => {
    const byKind = new Map<string, TaskKindDescriptor>();
    const byCategory = new Map<TaskKindCategory, TaskKindDescriptor[]>();

    for (const descriptor of descriptors) {
      byKind.set(descriptor.kind, descriptor);

      const group = byCategory.get(descriptor.category);
      if (group) {
        group.push(descriptor);
      } else {
        byCategory.set(descriptor.category, [descriptor]);
      }
    }

    return {
      descriptors,
      getByKind: (kind: string) => byKind.get(kind),
      getJsonSchema: (kind: string) => byKind.get(kind)?.configJsonSchema,
      categories: byCategory as ReadonlyMap<TaskKindCategory, readonly TaskKindDescriptor[]>,
      isLoading,
      error,
      refetch,
    };
  }, [descriptors, isLoading, error, refetch]);
}
