/**
 * AgentDetailView shows an agent's two tool lists, and each sub-agent's, in
 * plain words: "Only these tools" for `tools`, "Never these tools" for
 * `disallowedTools`, each entry verbatim. An empty list is no restriction and
 * shows nothing. Editing the sub-agent list rebuilds every sub-agent's input,
 * so a save must carry each sub-agent's lists through untouched; dropping them
 * would silently widen what the sub-agent may call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInput } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, spec);
  return agent;
}

function renderView(agent: Agent, props: { editable?: boolean } = {}) {
  const update = vi.fn(async (input: AgentInput) => {
    void input;
    return agent;
  });
  render(
    <AgentDetailView org="acme" slug="support-bot" editable={props.editable} />,
    {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    },
  );
  return { update };
}

describe("AgentDetailView tool lists", () => {
  it("shows the agent's allow-list and deny-list in plain words, entries verbatim", async () => {
    renderView(
      agentWith({
        instructions: "Answer tickets.",
        tools: ["Read", "Grep", "mcp__zendesk"],
        disallowedTools: ["Bash(git push *)"],
      }),
    );

    const only = await screen.findByRole("group", { name: "Only these tools" });
    expect(within(only).getByText("Read")).toBeTruthy();
    expect(within(only).getByText("Grep")).toBeTruthy();
    expect(within(only).getByText("mcp__zendesk")).toBeTruthy();

    const never = screen.getByRole("group", { name: "Never these tools" });
    expect(within(never).getByText("Bash(git push *)")).toBeTruthy();
  });

  it("shows only the list that is set", async () => {
    renderView(agentWith({ instructions: "Answer tickets.", disallowedTools: ["Bash"] }));

    expect(await screen.findByRole("group", { name: "Never these tools" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Only these tools" })).toBeNull();
  });

  it("shows no tool rows, and no Tools section, when neither list is set", async () => {
    renderView(agentWith({ instructions: "Answer tickets." }));

    expect(await screen.findByText("Answer tickets.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Only these tools" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Never these tools" })).toBeNull();
    expect(screen.queryByText("Tools")).toBeNull();
  });

  it("shows a sub-agent's own lists when it is expanded", async () => {
    renderView(
      agentWith({
        instructions: "Answer tickets.",
        subAgents: [
          {
            name: "researcher",
            description: "Digs up context",
            tools: ["Read", "WebFetch"],
            disallowedTools: ["mcp__zendesk__delete_ticket"],
          },
          { name: "writer", description: "Drafts replies" },
        ],
      }),
    );

    // Collapsed sub-agents show no list rows; the agent itself has none.
    await screen.findByRole("button", { name: /researcher/ });
    expect(screen.queryByRole("group", { name: "Only these tools" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /researcher/ }));
    const only = screen.getByRole("group", { name: "Only these tools" });
    expect(within(only).getByText("WebFetch")).toBeTruthy();
    const never = screen.getByRole("group", { name: "Never these tools" });
    expect(within(never).getByText("mcp__zendesk__delete_ticket")).toBeTruthy();

    // A sub-agent with no lists adds no rows when expanded.
    fireEvent.click(screen.getByRole("button", { name: /writer/ }));
    expect(screen.getAllByRole("group", { name: "Only these tools" })).toHaveLength(1);
  });

  it("keeps the other sub-agents' lists when one sub-agent is removed", async () => {
    const { update } = renderView(
      agentWith({
        instructions: "Answer tickets.",
        subAgents: [
          { name: "researcher", tools: ["Read"], disallowedTools: ["Bash"] },
          { name: "writer" },
        ],
      }),
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit sub-agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove writer" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0][0];
    expect(input.subAgents).toEqual([
      expect.objectContaining({
        name: "researcher",
        tools: ["Read"],
        disallowedTools: ["Bash"],
      }),
    ]);
  });
});
