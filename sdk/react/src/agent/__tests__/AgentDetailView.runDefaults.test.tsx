/**
 * AgentDetailView wires the "Run defaults" section to the agent update: one
 * save writes the engine (`harness`) and the run settings (`runConfig`)
 * together on the agent's update input, and a server refusal of that save
 * shows under the section, attributed to the run defaults.
 *
 * The section's own editing rules are pinned in
 * `AgentRunDefaultsSection.test.tsx`; this proves the view hands its save to
 * the update call and its refusal back to the section.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
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

function renderEditable(agent: Agent, update: (input: AgentInput) => Promise<Agent>) {
  render(<AgentDetailView org="acme" slug="support-bot" editable />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
}

const AGENT_SPEC: MessageInitShape<typeof AgentSpecSchema> = {
  instructions: "Answer tickets.",
  harness: Harness.CURSOR,
  runConfig: { modelName: "composer-2.5", maxToolRounds: 8 },
};

describe("AgentDetailView run defaults", () => {
  it("saves the engine and the run settings together on the agent update", async () => {
    const agent = agentWith(AGENT_SPEC);
    const update = vi.fn(async (input: AgentInput) => {
      void input;
      return agent;
    });
    renderEditable(agent, update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit run defaults" }));
    fireEvent.change(screen.getByPlaceholderText("No cap"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0][0];
    expect(input.harness).toBe(Harness.CURSOR);
    expect(input.runConfig).toEqual({
      modelName: "composer-2.5",
      maxCostUsd: 3,
      maxToolRounds: 8,
    });
    expect(input.instructions).toBe("Answer tickets.");
  });

  it("shows the server's refusal of the save under the run defaults", async () => {
    const agent = agentWith(AGENT_SPEC);
    const update = vi.fn(async (input: AgentInput): Promise<Agent> => {
      void input;
      throw new Error("model composer-2.5 is not listed for the cursor engine");
    });
    renderEditable(agent, update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit run defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /not listed for the cursor engine/,
    );
    // The edit stays open so the person can correct it.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
