"use client";

/**
 * Ranked list of the organization's agents by tokens, each with its runs,
 * working time, tokens, share of the organization's tokens and a
 * proportional bar.
 *
 * Rows arrive ordered by the server (`top_agents`, most tokens first); the
 * list only lays them out. Usage is tokens, never money. The suite in
 * `__tests__/AgentBreakdownList.test.tsx` pins the cells (working time among them), the share and the
 * optional links.
 */

import { cn } from "@stigmer/theme";
import type { AgentUsageSummary } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { formatCompactCount, formatWorkingTime, sharePercent } from "./format.js";

/** Props for {@link AgentBreakdownList}. */
export interface AgentBreakdownListProps {
  /** Top agents by tokens, ordered by total tokens descending. */
  readonly agents: readonly AgentUsageSummary[];
  /** The organization's total tokens (used to compute each agent's share). */
  readonly totalTokens: bigint;
  /** Optional href builder for agent links. Receives the agent ID. */
  readonly agentHref?: (agentId: string) => string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Renders a ranked list of agents by tokens with proportional bars.
 *
 * Each row shows the agent name, run count, working time, tokens with their share of
 * the organization's tokens, and a bar scaled to the top agent.
 */
export function AgentBreakdownList({
  agents,
  totalTokens,
  agentHref,
  className,
}: AgentBreakdownListProps) {
  if (agents.length === 0) return null;

  const maxTokens = Math.max(...agents.map((a) => Number(a.totalTokens)), 0);

  return (
    <div className={className}>
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Top Agents by Tokens
      </h3>
      <div
        className="stg:rounded-lg stg:border stg:border-border stg:bg-card"
        role="table"
        aria-label="Agent token breakdown"
      >
        <div
          role="row"
          className="stg:grid stg:grid-cols-[1fr_auto_auto_auto] stg:gap-x-4 stg:border-b stg:border-border stg:px-3.5 stg:py-2 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground"
        >
          <span role="columnheader">Agent</span>
          <span role="columnheader" className="stg:text-right">
            Runs
          </span>
          <span role="columnheader" className="stg:text-right">
            Working
          </span>
          <span role="columnheader" className="stg:text-right">
            Tokens
          </span>
        </div>
        {agents.map((agent) => {
          const tokens = Number(agent.totalTokens);
          const pct = sharePercent(tokens, totalTokens);
          const barWidth = maxTokens > 0 ? (tokens / maxTokens) * 100 : 0;

          const NameTag = agentHref ? "a" : "span";
          const nameProps = agentHref
            ? { href: agentHref(agent.agentId) }
            : {};

          return (
            <div
              key={agent.agentId}
              className="stg:border-b stg:border-border-muted stg:px-3.5 stg:py-2 stg:last:border-b-0"
            >
              <div
                role="row"
                className="stg:grid stg:grid-cols-[1fr_auto_auto_auto] stg:gap-x-4"
              >
                <div role="cell" className="stg:min-w-0">
                  <NameTag
                    {...nameProps}
                    className={cn(
                      "stg:block stg:truncate stg:text-xs stg:font-medium",
                      agentHref
                        ? "stg:text-primary stg:hover:underline"
                        : "stg:text-foreground",
                    )}
                  >
                    {agent.agentName || agent.agentId}
                  </NameTag>
                </div>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {agent.runCount}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatWorkingTime(agent.workingSeconds)}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-foreground"
                >
                  {formatCompactCount(tokens)}
                  <span className="stg:ml-1.5 stg:text-[0.6rem] stg:text-muted-foreground">
                    {pct}%
                  </span>
                </span>
              </div>
              {/* Bar scaled to the top agent */}
              <div className="stg:mt-1.5 stg:h-1 stg:w-full stg:rounded-full stg:bg-muted">
                <div
                  className="stg:h-full stg:rounded-full stg:bg-chart-2 stg:transition-all"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
