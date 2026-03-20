"use client";

import { useCallback, useMemo, useState } from "react";
import type { EnvVarInput } from "@stigmer/sdk";

/**
 * A single entry in the one-time secrets editor.
 *
 * Each entry maps to one environment variable that will be injected
 * into the agent sandbox for a single execution.
 */
export interface OneTimeSecretEntry {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
}

export interface UseOneTimeSecretsReturn {
  /** Current entries in the editor. */
  readonly entries: readonly OneTimeSecretEntry[];
  /** Append a blank entry. Defaults to `isSecret: true` (safer default). */
  readonly addEntry: () => void;
  /** Remove an entry by its unique ID. */
  readonly removeEntry: (id: string) => void;
  /** Patch one or more fields on an existing entry. */
  readonly updateEntry: (
    id: string,
    patch: { key?: string; value?: string; isSecret?: boolean },
  ) => void;
  /** Remove all entries. Call after submission to prevent stale secrets. */
  readonly clear: () => void;
  /** True when there are no entries at all. */
  readonly isEmpty: boolean;
  /**
   * True when at least one entry has a non-empty key AND non-empty value.
   * Use this to decide whether to include `runtimeEnv` in the execution.
   */
  readonly hasValidEntries: boolean;
  /**
   * Convert valid entries to the SDK input shape.
   *
   * Filters out entries with empty keys or values. When duplicate keys
   * exist, the last entry wins (consistent with environment semantics).
   */
  readonly toRuntimeEnv: () => Record<string, EnvVarInput>;
}

let nextId = 0;
function uid(): string {
  return `ots-${++nextId}-${Date.now()}`;
}

/**
 * Behavior hook that manages an array of one-time secret entries for
 * execution-scoped environment variables.
 *
 * One-time secrets are injected into the agent sandbox for a single
 * execution and deleted when it completes. They override both saved
 * Environment values and agent defaults.
 *
 * Follows the same controlled-state pattern as {@link useWorkspaceEntries}:
 * the consumer owns the hook instance, passes it to UI components, reads
 * the output during submission, and calls {@link UseOneTimeSecretsReturn.clear}
 * after sending to prevent stale secrets on the next follow-up.
 *
 * @example
 * ```tsx
 * function Chat({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *   const secrets = useOneTimeSecrets();
 *
 *   const handleSubmit = (message: string, model?: string) => {
 *     const runtimeEnv = secrets.isEmpty ? undefined : secrets.toRuntimeEnv();
 *     conv.sendFollowUp(message, { modelName: model, runtimeEnv });
 *     secrets.clear();
 *   };
 *
 *   return (
 *     <SessionComposer
 *       onSubmit={handleSubmit}
 *       secrets={secrets}
 *       disabled={!conv.canSendFollowUp}
 *       isSubmitting={conv.isSending}
 *     />
 *   );
 * }
 * ```
 */
export function useOneTimeSecrets(): UseOneTimeSecretsReturn {
  const [entries, setEntries] = useState<OneTimeSecretEntry[]>([]);

  const addEntry = useCallback(() => {
    setEntries((prev) => [
      ...prev,
      { id: uid(), key: "", value: "", isSecret: true },
    ]);
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const updateEntry = useCallback(
    (
      id: string,
      patch: { key?: string; value?: string; isSecret?: boolean },
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

  return {
    entries,
    addEntry,
    removeEntry,
    updateEntry,
    clear,
    isEmpty: entries.length === 0,
    hasValidEntries,
    toRuntimeEnv,
  };
}
