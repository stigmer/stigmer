"use client";

import { cn } from "@stigmer/theme";
import type { AgentUsageSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { formatCost } from "../execution/UsageWidget.js";

/** Props for {@link AgentBreakdownList}. */
export interface AgentBreakdownListProps {
  /** Top agents by cost, ordered by billable cost descending. */
  readonly agents: readonly AgentUsageSummary[];
  /** Total billable cost for the org (used to compute percentages). */
  readonly totalBillableCostMicros: bigint;
  /** Optional href builder for agent links. Receives the agent ID. */
  readonly agentHref?: (agentId: string) => string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Renders a ranked list of agents by cost with proportional cost bars.
 *
 * Each row shows the agent name, execution count, token usage,
 * billable cost, and a visual bar representing cost as a percentage
 * of the organization total.
 */
export function AgentBreakdownList({
  agents,
  totalBillableCostMicros,
  agentHref,
  className,
}: AgentBreakdownListProps) {
  if (agents.length === 0) return null;

  const totalCost = Number(totalBillableCostMicros);
  const maxCost =
    agents.length > 0 ? Number(agents[0].billableCostMicros) : 0;

  return (
    <div className={className}>
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Top Agents by Cost
      </h3>
      <div
        className="stg:rounded-lg stg:border stg:border-border stg:bg-card"
        role="table"
        aria-label="Agent cost breakdown"
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
            Tokens
          </span>
          <span role="columnheader" className="stg:text-right">
            Cost
          </span>
        </div>
        {agents.map((agent) => {
          const cost = Number(agent.billableCostMicros);
          const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
          const barWidth =
            maxCost > 0 ? (cost / maxCost) * 100 : 0;

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
                  {agent.executionCount}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatCompactTokens(Number(agent.totalTokens))}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-foreground"
                >
                  {formatCost(cost / 1_000_000)}
                  <span className="stg:ml-1.5 stg:text-[0.6rem] stg:text-muted-foreground">
                    {pct.toFixed(0)}%
                  </span>
                </span>
              </div>
              {/* Proportional cost bar */}
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

function formatCompactTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v >= 100 ? `${Math.round(v)}M` : `${trimZero(v.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v >= 100 ? `${Math.round(v)}K` : `${trimZero(v.toFixed(1))}K`;
  }
  return String(n);
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
