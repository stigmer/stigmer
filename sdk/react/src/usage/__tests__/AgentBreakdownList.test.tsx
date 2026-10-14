/**
 * AgentBreakdownList ranks agents by tokens: nothing for no agents; one row
 * per agent with its name (or id), run count, working time, compact token count and its
 * share of the organization's tokens, never money; names link only when an
 * href builder is given.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { AgentBreakdownList } from "../AgentBreakdownList";

afterEach(cleanup);

const agents = [
  create(AgentUsageSummarySchema, {
    agentId: "agt_1",
    agentName: "Support Bot",
    runCount: 42,
    totalTokens: 1_250_000n,
    workingSeconds: 7_380n,
  }),
  create(AgentUsageSummarySchema, {
    agentId: "agt_2",
    agentName: "",
    runCount: 7,
    totalTokens: 250_000n,
    workingSeconds: 252n,
  }),
];

describe("AgentBreakdownList", () => {
  it("renders nothing without agents", () => {
    const { container } = render(<AgentBreakdownList agents={[]} totalTokens={0n} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows each agent's runs, working time, tokens and share of the organization's tokens", () => {
    const { container } = render(<AgentBreakdownList agents={agents} totalTokens={2_000_000n} />);

    const table = screen.getByRole("table", { name: "Agent token breakdown" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Support Bot", "42", "2h 3m", "1.3M63%"],
      ["agt_2", "7", "4m 12s", "250.0k13%"],
    ]);
    expect(screen.getByText("Top Agents by Tokens")).toBeTruthy();
    expect(container.textContent).not.toContain("$");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links each agent through the href builder", () => {
    render(
      <AgentBreakdownList
        agents={agents}
        totalTokens={2_000_000n}
        agentHref={(id) => `/agents/${id}`}
      />,
    );
    expect(screen.getByRole("link", { name: "Support Bot" }).getAttribute("href")).toBe("/agents/agt_1");
  });
});
