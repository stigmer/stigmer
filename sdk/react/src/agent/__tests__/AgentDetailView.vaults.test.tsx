/**
 * AgentDetailView hands the vaults section's save to the agent update: the
 * chosen vault references ride the update's `vaults` field, and clearing the
 * last one sends no list. The section itself (listing, picking, its own
 * errors) is pinned in `vault/__tests__/vault-components.test.tsx`; it is
 * replaced here by a stub that saves what a test gives it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInput } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

vi.mock("../AgentVaultsSection.js", () => ({
  AgentVaultsSection: ({
    onSave,
  }: {
    readonly onSave: (refs: Array<{ org: string; slug: string }>) => Promise<boolean>;
  }) => (
    <div>
      <button type="button" onClick={() => void onSave([{ org: ACME_ID, slug: "support-tools" }])}>
        Save one vault
      </button>
      <button type="button" onClick={() => void onSave([])}>
        Save no vaults
      </button>
    </div>
  ),
}));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

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

describe("AgentDetailView vaults", () => {
  it("saves the chosen vaults on the agent update, and no list once the last is removed", async () => {
    const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
    agent.spec = create(AgentSpecSchema, { instructions: "Answer tickets." });
    const update = vi.fn(async (input: AgentInput) => {
      void input;
      return agent;
    });
    renderEditable(agent, update);

    fireEvent.click(await screen.findByRole("button", { name: "Save one vault" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].vaults).toEqual([{ org: ACME_ID, slug: "support-tools" }]);

    fireEvent.click(screen.getByRole("button", { name: "Save no vaults" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0].vaults).toBeUndefined();
  });
});
