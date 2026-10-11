/**
 * AgentDetailView shows an agent's two tool lists in plain words: "Only these
 * tools" for `tools`, "Never these tools" for `disallowedTools`, each entry
 * verbatim. An empty list is no restriction and shows nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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
});
