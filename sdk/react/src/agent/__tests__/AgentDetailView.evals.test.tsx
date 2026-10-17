/**
 * Pins the agent detail view's Evals tab: it sits right after Quality,
 * built in; opening it lists the agent's evals through
 * `evalrun.listByAgent`, a try opens its run through the host's
 * `onNavigateToRun`; and for an agent that attaches no plugins its way to
 * the plugins opens the Overview, where they are attached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { agentEvalRunWith } from "../../eval-run/__tests__/eval-fixture.agent";

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: () => <span>model picker</span>,
}));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function renderView(plugins: readonly string[], onNavigateToRun = vi.fn()) {
  const agent = samples.agent({ name: "Reviewer", org: ACME_ID });
  agent.spec = { ...agent.spec!, plugins: plugins.map((slug) => ({ org: ACME_ID, slug })) } as typeof agent.spec;
  const latest = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "review-fires", score: 1 }] }]);
  const listByAgent = vi.fn(async () => ({ entries: [latest], nextPageToken: "" }));
  render(<AgentDetailView org="acme" slug="reviewer" onNavigateToRun={onNavigateToRun} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
        evalrun: { listByAgent, get: vi.fn(async () => latest) },
        scoringrule: {
          getByAgent: vi.fn(async () => {
            throw new StigmerError("not-found", "no scoring rule", Code.NotFound);
          }),
        },
        plugin: { getByReference: vi.fn(async () => undefined) },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
  return { agent, listByAgent, onNavigateToRun };
}

describe("AgentDetailView's Evals tab", () => {
  it("sits after Quality and opens to the agent's evals, each try opening its run", async () => {
    const { agent, listByAgent, onNavigateToRun } = renderView(["thermos"]);
    const tabs = (await screen.findAllByRole("tab")).map((tab) => tab.textContent);
    expect(tabs.indexOf("Evals")).toBe(tabs.indexOf("Quality") + 1);
    fireEvent.click(screen.getByRole("tab", { name: "Evals" }));
    const plugin = await screen.findByRole("region", { name: "Plugin thermos" });
    expect(listByAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: agent.metadata!.id }));
    fireEvent.click(within(plugin).getByRole("button", { name: "review-fires" }));
    fireEvent.click(within(plugin).getByRole("button", { name: "#1: 1.00" }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_thermos_review-fires_1");
  });

  it("takes an agent with no plugins to its Overview, where plugins are attached", async () => {
    renderView([]);
    fireEvent.click(await screen.findByRole("tab", { name: "Evals" }));
    fireEvent.click(await screen.findByRole("button", { name: "Go to the agent's plugins" }));
    expect(
      (await screen.findByRole("tab", { name: "Overview" })).getAttribute("aria-selected"),
    ).toBe("true");
  });
});
