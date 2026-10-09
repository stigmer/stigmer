/**
 * Pins the agent detail view's Quality tab: it is offered beside Shares,
 * and opening it shows the agent's AI grading read through
 * `evaluator.getByAgent`, editable on a plugin-managed agent too when the
 * host makes the view editable (grading is not the agent's definition).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: () => <span>model picker</span>,
}));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("AgentDetailView's Quality tab", () => {
  it("opens to the agent's AI grading, off until switched on", async () => {
    const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
    agent.metadata = { ...agent.metadata!, labels: { "stigmer.ai/plugin": "acme/support" } };
    const getByAgent = vi.fn(async () => {
      throw new StigmerError("not-found", "no evaluator", Code.NotFound);
    });
    render(<AgentDetailView org="acme" slug="support-bot" editable />, {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
          evaluator: { getByAgent, create: vi.fn(), update: vi.fn() },
          plugin: { getByReference: vi.fn(async () => undefined) },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    });
    fireEvent.click(await screen.findByRole("tab", { name: "Quality" }));
    const toggle = await screen.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((toggle as HTMLButtonElement).disabled, "editable on a plugin-managed agent").toBe(false);
    expect(getByAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: agent.metadata.id }));
  });
});
