"use client";

import { useCallback, useMemo, useState } from "react";
import type { EnvVarInput } from "@stigmer/sdk";

/**
 * A single entry in the session variables editor.
 *
 * Each entry maps to one environment variable. When `saveForFuture`
 * is `false` (default), the value is injected into the agent sandbox
 * for a single execution only. When `true`, the value is persisted
 * to the user's personal environment for reuse across sessions.
 */
export interface SessionVariableEntry {
  /** Unique identifier for this entry (auto-generated). */
  readonly id: string;
  /** Environment variable name. */
  readonly key: string;
  /** Environment variable value. */
  readonly value: string;
  /** Whether the value should be masked in the UI. */
  readonly isSecret: boolean;
  /** When `true`, persists the value to the user's personal environment on submit. */
  readonly saveForFuture: boolean;
}

/** Return value of {@link useSessionVariables}. */
export interface UseSessionVariablesReturn {
  /** Current entries in the editor. */
  readonly entries: readonly SessionVariableEntry[];
  /** Append a blank entry. Defaults to `isSecret: true` (safer default). */
  readonly addEntry: () => void;
  /** Remove an entry by its unique ID. */
  readonly removeEntry: (id: string) => void;
  /** Patch one or more fields on an existing entry. */
  readonly updateEntry: (
    id: string,
    patch: { key?: string; value?: string; isSecret?: boolean; saveForFuture?: boolean },
  ) => void;
  /** Remove all entries. Call after submission to prevent stale values. */
  readonly clear: () => void;
  /** True when there are no entries at all. */
  readonly isEmpty: boolean;
  /**
   * True when at least one entry has a non-empty key AND non-empty value.
   * Use this to decide whether to include `runtimeEnv` in the execution.
   */
  readonly hasValidEntries: boolean;
  /**
   * Convert valid entries to the SDK input shape for execution-scoped
   * runtime env.
   *
   * Includes all entries with non-empty keys and values, regardless of
   * `saveForFuture`. When duplicate keys exist, the last entry wins
   * (consistent with environment semantics).
   */
  readonly toRuntimeEnv: () => Record<string, EnvVarInput>;
  /**
   * Convert valid save-for-future entries (saveForFuture === true) to
   * the SDK input shape for personal environment persistence.
   *
   * Filters out entries with empty keys or values. When duplicate keys
   * exist, the last entry wins.
   */
  readonly toSaveForFutureEnv: () => Record<string, EnvVarInput>;
  /**
   * True when at least one valid entry has `saveForFuture === true`.
   */
  readonly hasSaveForFutureEntries: boolean;
}

let nextId = 0;
function uid(): string {
  return `sv-${++nextId}-${Date.now()}`;
}

/**
 * Behavior hook that manages an array of session variable entries for
 * execution-scoped environment variables.
 *
 * Session variables are injected into the agent sandbox at execution
 * time. By default they are ephemeral (single execution), but users
 * can opt into persisting individual entries to their personal
 * environment via the `saveForFuture` flag.
 *
 * Follows the same controlled-state pattern as {@link useWorkspaceEntries}:
 * the consumer owns the hook instance, passes it to UI components, reads
 * the output during submission, and calls {@link UseSessionVariablesReturn.clear}
 * after sending to prevent stale values on the next follow-up.
 *
 * @example
 * ```tsx
 * function Chat({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *   const sessionVariables = useSessionVariables();
 *
 *   const handleSubmit = (message: string, model?: string) => {
 *     const runtimeEnv = sessionVariables.isEmpty
 *       ? undefined
 *       : sessionVariables.toRuntimeEnv();
 *     conv.sendFollowUp(message, { modelName: model, runtimeEnv });
 *     sessionVariables.clear();
 *   };
 *
 *   return (
 *     <SessionComposer
 *       onSubmit={handleSubmit}
 *       sessionVariables={sessionVariables}
 *       disabled={!conv.canSendFollowUp}
 *       isSubmitting={conv.isSending}
 *     />
 *   );
 * }
 * ```
 */
export function useSessionVariables(): UseSessionVariablesReturn {
  const [entries, setEntries] = useState<SessionVariableEntry[]>([]);

  const addEntry = useCallback(() => {
    setEntries((prev) => [
      ...prev,
      { id: uid(), key: "", value: "", isSecret: true, saveForFuture: false },
    ]);
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const updateEntry = useCallback(
    (
      id: string,
      patch: { key?: string; value?: string; isSecret?: boolean; saveForFuture?: boolean },
    ) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  const hasValidEntries = useMemo(
    () => entries.some((e) => e.key.trim() !== "" && e.value.trim() !== ""),
    [entries],
  );

  const toRuntimeEnv = useCallback((): Record<string, EnvVarInput> => {
    const result: Record<string, EnvVarInput> = {};
    for (const entry of entries) {
      const key = entry.key.trim();
      if (key === "" || entry.value.trim() === "") continue;
      result[key] = { value: entry.value, isSecret: entry.isSecret };
    }
    return result;
  }, [entries]);

  const toSaveForFutureEnv = useCallback((): Record<string, EnvVarInput> => {
    const result: Record<string, EnvVarInput> = {};
    for (const entry of entries) {
      const key = entry.key.trim();
      if (key === "" || entry.value.trim() === "") continue;
      if (!entry.saveForFuture) continue;
      result[key] = { value: entry.value, isSecret: entry.isSecret };
    }
    return result;
  }, [entries]);

  const hasSaveForFutureEntries = useMemo(
    () =>
      entries.some(
        (e) =>
          e.saveForFuture &&
          e.key.trim() !== "" &&
          e.value.trim() !== "",
      ),
    [entries],
  );

  const isEmpty = entries.length === 0;

  return useMemo(
    () => ({
      entries,
      addEntry,
      removeEntry,
      updateEntry,
      clear,
      isEmpty,
      hasValidEntries,
      toRuntimeEnv,
      toSaveForFutureEnv,
      hasSaveForFutureEntries,
    }),
    [entries, addEntry, removeEntry, updateEntry, clear, isEmpty, hasValidEntries, toRuntimeEnv, toSaveForFutureEnv, hasSaveForFutureEntries],
  );
}
