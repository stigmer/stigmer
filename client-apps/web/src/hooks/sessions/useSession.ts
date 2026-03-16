"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { sessionKeys } from "./keys";

/**
 * Fetches a single Session resource by ID.
 *
 * The query is disabled when `sessionId` is falsy, allowing conditional
 * fetching (e.g. before an ID is available from route params).
 */
export function useSession(sessionId: string) {
  const stigmer = useStigmer();

  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => stigmer.session.get(sessionId),
    enabled: !!sessionId,
  });
}
