/**
 * Pins the agent detail view's Quality tab: it is offered beside Shares,
 * and opening it shows the agent's AI grading read through
 * `evaluator.getByAgent`, editable on a plugin-managed agent too when the
 * host makes the view editable (grading is not the agent's definition).
 * The report on top hands the view's `onNavigateToRun` to its flagged
 * runs, and a version's eval link opens the Evals tab on that eval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { agentEvalRunWith } from "../../eval-run/__tests__/eval-fixture.agent";
import {
  VERSION_HASH,
  emptyReport,
  flaggedScore,
  qualityReport,
} from "../../score/__tests__/quality-fixture";

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
          score: {
            getAgentQualityReport: vi.fn(async () => emptyReport()),
            listFlaggedByAgent: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
          },
          evalrun: { listByAgent: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
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

  it("opens a flagged run through the host, and a version's eval on the Evals tab", async () => {
    const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
    const newer = agentEvalRunWith([], { id: "evr_newer", version: "ffffffffffffffff" });
    const linked = agentEvalRunWith([{ slug: "p", cases: [{ name: "a", score: 1 }] }], {
      id: "evr_linked",
      version: VERSION_HASH,
    });
    const onNavigateToRun = vi.fn();
    render(<AgentDetailView org="acme" slug="support-bot" onNavigateToRun={onNavigateToRun} />, {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
          evaluator: {
            getByAgent: vi.fn(async () => {
              throw new StigmerError("not-found", "no evaluator", Code.NotFound);
            }),
          },
          score: {
            getAgentQualityReport: vi.fn(async () => qualityReport()),
            listFlaggedByAgent: vi.fn(async () => ({ entries: [flaggedScore("s1", "judge", "run_judged", ["task"])],
              nextPageToken: "" })),
          },
          evalrun: {
            listByAgent: vi.fn(async () => ({ entries: [newer, linked], nextPageToken: "" })),
            get: vi.fn(async (id: string) => (id === "evr_linked" ? linked : newer)),
          },
          plugin: { getByReference: vi.fn(async () => undefined) },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    });
    fireEvent.click(await screen.findByRole("tab", { name: "Quality" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Open run: AI judge: task/ }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_judged");

    fireEvent.click(await screen.findByRole("button", { name: "100% of 1 case" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Evals" }).getAttribute("aria-selected")).toBe("true"),
    );
    const past = await screen.findByRole("list", { name: "Past eval runs" });
    const current = within(past)
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-current") === "true");
    expect(current?.textContent).toContain(`Version ${VERSION_HASH.slice(0, 8)}`);
  });
});
