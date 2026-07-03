"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSecretValueInputSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Options for {@link useRevealSecretValue}. */
export interface UseRevealSecretValueOptions {
  /**
   * Milliseconds after which the revealed value is automatically cleared
   * from component state. Prevents sensitive values from lingering in memory.
   *
   * - Default: `30_000` (30 seconds) — enough time to copy a value.
   * - Set to `0` to disable auto-clear (caller is responsible for clearing).
   */
  readonly autoClearMs?: number;
}

/** Return value of {@link useRevealSecretValue}. */
export interface UseRevealSecretValueReturn {
  /**
   * Fetch and reveal a single secret value from an environment.
   * Replaces any previously revealed value. Resets error state.
   *
   * @param environmentId - The environment resource ID.
   * @param key - The key within `spec.data` to reveal.
   */
  readonly reveal: (environmentId: string, key: string) => Promise<void>;

  /** The decrypted value, or `null` when not yet revealed or cleared. */
  readonly revealedValue: string | null;

  /** `true` while the reveal request is in-flight. */
  readonly isRevealing: boolean;

  /** Error message from the last failed reveal attempt, or `null`. */
  readonly error: Error | null;

  /** Immediately clear the revealed value and cancel any pending auto-clear timer. */
  readonly clearRevealedValue: () => void;
}

const DEFAULT_AUTO_CLEAR_MS = 30_000;

/**
 * Behavior hook that encapsulates the "reveal secret" interaction.
 *
 * Fetches a single unredacted secret value via
 * `stigmer.environment.getSecretValue()`, holds the decrypted value in
 * state, and auto-clears it after a configurable timeout.
 *
 * This is an **imperative** hook (call `reveal()` on user action),
 * not a declarative data hook (no auto-fetch on mount). It pairs with
 * a "reveal" / "show" button in the UI — the canonical pattern for
 * sensitive credential display (AWS, GitHub, 1Password).
 *
 * Follows the headless-first pattern: pure behavior, zero rendering.
 * Platform builders compose this hook with their own UI.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**.
 *
 * @example
 * ```tsx
 * function SecretField({ envId, secretKey }: Props) {
 *   const { reveal, revealedValue, isRevealing, clearRevealedValue } =
 *     useRevealSecretValue();
 *
 *   return revealedValue ? (
 *     <div>
 *       <code>{revealedValue}</code>
 *       <button onClick={clearRevealedValue}>Hide</button>
 *     </div>
 *   ) : (
 *     <button onClick={() => reveal(envId, secretKey)} disabled={isRevealing}>
 *       {isRevealing ? "Revealing…" : "Reveal"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useRevealSecretValue(
  options?: UseRevealSecretValueOptions,
): UseRevealSecretValueReturn {
  const stigmer = useStigmer();
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const autoClearMs = options?.autoClearMs ?? DEFAULT_AUTO_CLEAR_MS;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearRevealedValue = useCallback(() => {
    cancelTimer();
    setRevealedValue(null);
  }, [cancelTimer]);

  // Clean up timer and clear value on unmount
  useEffect(() => {
    return () => {
      cancelTimer();
      setRevealedValue(null);
    };
  }, [cancelTimer]);

  const reveal = useCallback(
    async (environmentId: string, key: string): Promise<void> => {
      cancelTimer();
      setIsRevealing(true);
      setError(null);

      try {
        const result = await stigmer.environment.getSecretValue(
          create(EnvironmentSecretValueInputSchema, { environmentId, key }),
        );
        setRevealedValue(result.value ?? null);

        if (autoClearMs > 0) {
          timerRef.current = setTimeout(() => {
            setRevealedValue(null);
            timerRef.current = null;
          }, autoClearMs);
        }
      } catch (err) {
        setError(toError(err));
        setRevealedValue(null);
      } finally {
        setIsRevealing(false);
      }
    },
    [stigmer, autoClearMs, cancelTimer],
  );

  return { reveal, revealedValue, isRevealing, error, clearRevealedValue };
}
