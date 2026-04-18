"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { ListPlatformClientsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link usePlatformClientList}. */
export interface UsePlatformClientListReturn {
  /** All platform clients for the organization. Empty while loading or on error. */
  readonly platformClients: readonly PlatformClient[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all platform clients for an organization.
 *
 * Platform clients are admin-level resources with small cardinality
 * (typically 1–5 per org), so results are returned as a flat list
 * without pagination.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after mutations (create / update / delete / rotateSecret).
 *
 * @example
 * ```tsx
 * function PlatformClientSettings({ org }: { org: string }) {
 *   const { platformClients, isLoading, error } = usePlatformClientList(org);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return (
 *     <ul>
 *       {platformClients.map((pc) => (
 *         <li key={pc.metadata?.id}>{pc.metadata?.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function usePlatformClientList(
  org: string | null,
): UsePlatformClientListReturn {
  const stigmer = useStigmer();
  const [platformClients, setPlatformClients] = useState<PlatformClient[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setPlatformClients([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.platformclient
      .listByOrg(
        create(ListPlatformClientsByOrgInputSchema, { org }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setPlatformClients([...result.entries]);
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
  }, [org, stigmer, fetchKey]);

  return { platformClients, isLoading, error, refetch };
}
