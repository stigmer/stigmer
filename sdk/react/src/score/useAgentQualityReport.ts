"use client";

/**
 * Data hook for how one agent's runs were graded in the active
 * organization over the last few days: the counts in total, per UTC day and
 * per agent version, read through `score.getAgentQualityReport()`.
 *
 * The organization is the active one, not the agent's: an agent shared
 * into a child organization is graded there on that organization's runs,
 * and the server counts only the named organization's runs. The report
 * carries counts and names only, never a conversation's text, so it counts
 * every run of the agent in the organization, the ones the viewer cannot
 * open included. A refusal (no access, or too many grades to count in one
 * read) arrives as the hook's error with the server's message. An empty
 * agent id or no active organization asks nothing. Pinned by
 * `__tests__/quality-hooks.test.tsx`.
 */

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetAgentQualityReportRequestSchema,
  type AgentQualityReport,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";

/** Return value of {@link useAgentQualityReport}. */
export interface UseAgentQualityReportReturn {
  /** The report, or `null` before the first answer and while idle. */
  readonly report: AgentQualityReport | null;
  /** `true` until the first answer (or refusal) for the current agent, window and organization. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Read the report again. */
  readonly refetch: () => void;
}

/**
 * Data hook that reads an agent's quality report for the active
 * organization: `days` days ending today (UTC), 1 to 90, where 0 asks for
 * the server's default of 30.
 *
 * Pass an empty `agentId` to skip fetching, while the agent is loading.
 *
 * @example
 * ```tsx
 * const { report, error } = useAgentQualityReport(agent.metadata?.id ?? "", 30);
 * ```
 */
export function useAgentQualityReport(
  agentId: string,
  days: number,
): UseAgentQualityReportReturn {
  const stigmer = useStigmer();
  const org = useActiveOrgId();

  const enabled = agentId !== "" && org !== "";
  const { data, isLoading: fetching, error, refetch } = useFetch(
    enabled
      ? (): Promise<AgentQualityReport | null> =>
          stigmer.score.getAgentQualityReport(
            create(GetAgentQualityReportRequestSchema, { org, agentId, days }),
          )
      : null,
    [org, agentId, days, stigmer],
    null,
  );
  // Loading until the first answer: the render that enables the read comes
  // before the read starts, and must not pass for an empty report.
  const isLoading = fetching || (enabled && data === null && error === null);

  return useMemo(
    () => ({ report: data, isLoading, error, refetch }),
    [data, isLoading, error, refetch],
  );
}
