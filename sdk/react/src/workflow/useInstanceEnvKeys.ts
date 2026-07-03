"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { useStigmer } from "../hooks.js";

/** Return value of {@link useInstanceEnvKeys}. */
export interface UseInstanceEnvKeysReturn {
  /** Set of env var keys provided by the instance's bound environments. */
  readonly instanceEnvKeys: Set<string>;
  /** `true` while environment fetches are in flight. */
  readonly isLoading: boolean;
}

const EMPTY_SET: Set<string> = new Set();

/**
 * Resolves the selected instance's `environmentRefs` into the set of
 * env var keys those environments provide.
 *
 * When `instance` is `null` or has no `environmentRefs`, returns an
 * empty set immediately. Otherwise fetches each referenced environment
 * and collects all keys from their `spec.data` maps.
 *
 * Used by the run dialog to determine which declared env vars are
 * already satisfied by the instance's bound environments, so validation
 * can be relaxed and the UI can indicate "provided by instance".
 */
export function useInstanceEnvKeys(
  instance: WorkflowInstance | null | undefined,
  org: string,
): UseInstanceEnvKeysReturn {
  const stigmer = useStigmer();
  const [keys, setKeys] = useState<Set<string>>(EMPTY_SET);
  const [isLoading, setIsLoading] = useState(false);

  const refs = instance?.spec?.environmentRefs;
  const refKey = useMemo(
    () => (refs ?? []).map((r) => `${r.org || org}/${r.slug}`).join(","),
    [refs, org],
  );

  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;

  useEffect(() => {
    if (!refs || refs.length === 0) {
      setKeys(EMPTY_SET);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const resolveKeys = async () => {
      try {
        const results = await Promise.all(
          refs.map((ref) =>
            stigmerRef.current.environment.getByReference({
              org: ref.org || org,
              slug: ref.slug,
            }),
          ),
        );

        if (cancelled) return;

        const collected = new Set<string>();
        for (const env of results) {
          if (env?.spec?.data) {
            for (const key of Object.keys(env.spec.data)) {
              collected.add(key);
            }
          }
        }
        setKeys(collected);
      } catch {
        if (!cancelled) {
          setKeys(EMPTY_SET);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    resolveKeys();
    return () => { cancelled = true; };
  }, [refKey, org]);

  return { instanceEnvKeys: keys, isLoading };
}
