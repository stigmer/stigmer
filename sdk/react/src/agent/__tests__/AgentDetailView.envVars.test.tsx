/**
 * AgentDetailView's read-only "Environment Variables" section: each
 * variable the agent declares is listed by name, sorted, with a pill that
 * says whether it is a secret or plain config, and its description when it
 * has one. A viewer who may not edit sees this list, not the editor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
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

function renderReadOnly(agent: Agent) {
  render(<AgentDetailView org="acme" slug="support-bot" editable={false} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update: vi.fn(async () => agent) },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
}

describe("AgentDetailView environment variables (read-only)", () => {
  it("lists each variable by name, sorted, marked secret or config, with its description", async () => {
    renderReadOnly(
      agentWith({
        instructions: "Answer tickets.",
        env: {
          ZENDESK_TOKEN: { isSecret: true, description: "API token for the help desk" },
          LOG_LEVEL: { isSecret: false },
        },
      }),
    );

    const heading = await screen.findByRole("heading", { name: "Environment Variables" });
    const section = heading.closest("section") as HTMLElement;

    const names = within(section)
      .getAllByText(/^(LOG_LEVEL|ZENDESK_TOKEN)$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["LOG_LEVEL", "ZENDESK_TOKEN"]);

    const logRow = within(section).getByText("LOG_LEVEL").parentElement as HTMLElement;
    expect(within(logRow).getByText("config")).toBeTruthy();
    const tokenRow = within(section).getByText("ZENDESK_TOKEN").parentElement as HTMLElement;
    expect(within(tokenRow).getByText("secret")).toBeTruthy();
    expect(within(tokenRow).getByText("API token for the help desk")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Edit environment variables" })).toBeNull();
  });
});
