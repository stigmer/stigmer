"use client";

/**
 * Ranked table of the organization's agents by tokens, each with its runs,
 * working time, tokens and share of the organization's tokens.
 *
 * Rows arrive ordered by the server (`top_agents`, most tokens first); the
 * table only lays them out. Usage is tokens, never money. The suite in
 * `__tests__/AgentBreakdownList.test.tsx` pins the cells (working time among them), the share and the
 * optional links.
 */

import { Section } from "../resource-detail/Section.js";
import { Table, type TableColumn } from "../internal/surface/Table.js";
import type { AgentUsageSummary } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
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
 * Renders the organization's agents ranked by tokens, on the table part in
 * a section headed "Top agents by tokens".
 *
 * Each row shows the agent's name (a link when `agentHref` is given), its
 * runs, working time, tokens and share of the organization's tokens. Under
 * 640px of its own width each agent is a list row.
 */
export function AgentBreakdownList({
  agents,
  totalTokens,
  agentHref,
  className,
}: AgentBreakdownListProps) {
  if (agents.length === 0) return null;

  const columns: readonly TableColumn<AgentUsageSummary>[] = [
    { id: "agent", header: "Agent", cell: (agent) => agent.agentName || agent.agentId },
    { id: "runs", header: "Runs", align: "end", cell: (agent) => agent.runCount },
    { id: "working", header: "Working", align: "end", cell: (agent) => formatWorkingTime(agent.workingSeconds) },
    { id: "tokens", header: "Tokens", align: "end", cell: (agent) => formatCompactCount(Number(agent.totalTokens)) },
    {
      id: "share",
      header: "Share",
      align: "end",
      cell: (agent) => `${sharePercent(Number(agent.totalTokens), totalTokens)}%`,
    },
  ];

  return (
    <Section title="Top agents by tokens" className={className}>
      <Table
        bare
        aria-label="Agent token breakdown"
        columns={columns}
        rows={agents}
        rowKey={(agent) => agent.agentId}
        rowHref={agentHref ? (agent) => agentHref(agent.agentId) : undefined}
      />
    </Section>
  );
}
