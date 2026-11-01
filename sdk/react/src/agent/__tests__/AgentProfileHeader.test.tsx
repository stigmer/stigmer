/**
 * Pins the agent's profile header: its face, its name as the page's
 * heading, what it does, its qualified slug, who made it, and one line of
 * facts in order (the model it runs, by the catalogue's name, then its
 * skills, plugins, MCP servers, sub-agents, channels and versions), each
 * count only when the agent has some, and the conversation's model named
 * when the agent sets none.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { samples } from "@stigmer/react-core/test";
import { AgentProfileHeader } from "../AgentProfileHeader";

vi.mock("../../models/useModelRegistry.js", () => ({
  useModelRegistry: () => ({
    getModel: (id: string) => (id === "claude-sonnet-4-6" ? { displayName: "Claude Sonnet 4.6" } : undefined),
  }),
}));

vi.mock("../../organization/useOrgRefs.js", () => ({
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
}));

afterEach(cleanup);

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Ledger", slug: "ledger", org: "org_acme" });
  agent.spec = create(AgentSpecSchema, spec);
  agent.status = create(AgentStatusSchema, {
    audit: { specAudit: { createdBy: { id: "ia-ada", displayName: "Ada Lovelace", email: "ada@acme.example" } } },
  });
  return agent;
}

function facts(): string[] {
  return within(screen.getByRole("list", { name: "What the agent is made of" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("AgentProfileHeader", () => {
  it("names the agent, says what it does and who made it, and lists what it is made of in order", () => {
    const agent = agentWith({
      description: "Reconciles the books every night.",
      runConfig: { modelName: "claude-sonnet-4-6" },
      skillRefs: [{ org: "org_acme", slug: "ledger-rules" }, { org: "org_acme", slug: "csv" }],
      plugins: [{ org: "org_acme", slug: "linear" }],
      subagents: [{ org: "org_acme", slug: "auditor" }],
    });
    render(<AgentProfileHeader agent={agent} icon={<span>face</span>} versionCount={3} channelCount={1} />);

    expect(screen.getByRole("heading", { level: 2, name: "Ledger" })).toBeTruthy();
    expect(screen.getByText("Reconciles the books every night.")).toBeTruthy();
    expect(screen.getByText("acme/ledger")).toBeTruthy();
    expect(screen.getByText("Made by Ada Lovelace")).toBeTruthy();
    expect(facts()).toEqual(["Claude Sonnet 4.6", "2 skills", "1 plugin", "1 sub-agent", "1 channel", "3 versions"]);
  });

  it("leaves out what the agent has none of, and names the conversation's model when it sets none", () => {
    render(<AgentProfileHeader agent={agentWith({})} icon={null} versionCount={undefined} channelCount={0} />);

    expect(facts()).toEqual(["The conversation's model"]);
  });
});
