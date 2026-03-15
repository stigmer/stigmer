"use client";

import { useQuery } from "@tanstack/react-query";
import { useSessionQueryService } from "@stigmer/session";
import { sessionKeys } from "./keys";

/**
 * Fetches a single Session resource by ID.
 *
 * The query is disabled when `sessionId` is falsy, allowing conditional
 * fetching (e.g. before an ID is available from route params).
 */
export function useSession(sessionId: string) {
  const service = useSessionQueryService();

  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => service.get(sessionId),
    enabled: !!sessionId,
  });
}
