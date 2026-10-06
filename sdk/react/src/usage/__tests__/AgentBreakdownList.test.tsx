/**
 * AgentBreakdownList ranks agents by cost: nothing for no agents; one row per
 * agent with its name (or id), run count, compact token count, cost and its
 * share of the organization's total; names link only when an href builder is
 * given.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { AgentBreakdownList } from "../AgentBreakdownList";

afterEach(cleanup);

const agents = [
  create(AgentUsageSummarySchema, {
    agentId: "agt_1",
    agentName: "Support Bot",
    runCount: 42,
    totalTokens: 1_250_000n,
    billableCostMicros: 3_000_000n,
  }),
  create(AgentUsageSummarySchema, {
    agentId: "agt_2",
    agentName: "",
    runCount: 7,
    totalTokens: 900n,
    billableCostMicros: 1_000_000n,
  }),
];

describe("AgentBreakdownList", () => {
  it("renders nothing without agents", () => {
    const { container } = render(<AgentBreakdownList agents={[]} totalBillableCostMicros={0n} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows each agent's runs, tokens, cost and share of the total", () => {
    render(<AgentBreakdownList agents={agents} totalBillableCostMicros={4_000_000n} />);

    const table = screen.getByRole("table", { name: "Agent cost breakdown" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Support Bot", "42", "1.3M", "$3.0075%"],
      ["agt_2", "7", "900", "$1.0025%"],
    ]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links each agent through the href builder", () => {
    render(
      <AgentBreakdownList
        agents={agents}
        totalBillableCostMicros={4_000_000n}
        agentHref={(id) => `/agents/${id}`}
      />,
    );
    expect(screen.getByRole("link", { name: "Support Bot" }).getAttribute("href")).toBe("/agents/agt_1");
  });
});
