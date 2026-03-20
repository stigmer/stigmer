"use client";

import { useEffect, useState } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface UseSessionReturn {
  readonly session: Session | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Data hook that fetches a single Session by ID.
 *
 * Pass `null` to skip fetching (stable no-op). When the `id` changes,
 * the previous in-flight request is discarded and a fresh fetch begins.
 *
 * Returns the full proto {@link Session} resource so consumers have
 * access to metadata, spec, and status without additional calls.
 */
export function useSession(id: string | null): UseSessionReturn {
  const stigmer = useStigmer();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) {
      setSession(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.session.get(id).then(
      (result) => {
        if (cancelled.current) return;
        setSession(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [id, stigmer]);

  return { session, isLoading, error };
}
