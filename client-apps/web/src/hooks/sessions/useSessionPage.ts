"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { create } from "@bufbuild/protobuf";
import {
  ListSessionsRequestSchema,
  ListSessionsByAgentRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { sessionKeys } from "./keys";

const DEFAULT_PAGE_SIZE = 20;

export interface UseSessionPageOptions {
  page: number;
  pageSize?: number;
  agentId?: string;
  tags?: string[];
}

/**
 * Page-based session query for table views.
 *
 * Uses `useQuery` (not `useInfiniteQuery`) so the table can navigate to
 * arbitrary pages via Previous/Next controls. When `agentId` is provided,
 * delegates to `service.listByAgent()`; otherwise uses `service.list()`.
 *
 * Each (page, pageSize, agentId, tags) combination is cached independently
 * by TanStack Query.
 */
export function useSessionPage(options: UseSessionPageOptions) {
  const { page, pageSize = DEFAULT_PAGE_SIZE, agentId, tags } = options;
  const stigmer = useStigmer();

  const pageToken = page > 1 ? String(page - 1) : "";

  const query = useQuery({
    queryKey: sessionKeys.page({ page, pageSize, agentId, tags }),
    queryFn: () => {
      if (agentId) {
        return stigmer.session.listByAgent(
          create(ListSessionsByAgentRequestSchema, {
            agentId,
            pageSize,
            pageToken,
          }),
        );
      }
      return stigmer.session.list(
        create(ListSessionsRequestSchema, {
          pageSize,
          pageToken,
          tags: tags ?? [],
        }),
      );
    },
  });

  return {
    sessions: query.data?.entries ?? [],
    totalPages: query.data?.totalPages ?? 0,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
