/**
 * Pins the agent detail view's Quality tab: it is offered beside Channels,
 * and opening it shows the agent's AI grading read through
 * `scoringrule.getByAgent`, editable on a plugin-managed agent too when the
 * host makes the view editable (grading is not the agent's definition).
 * The report on top hands the view's `onNavigateToRun` to its flagged
 * runs, and a version's eval link opens the Evals tab on that eval. The
 * Channels tab in the second slot lists every channel of the agent (chat
 * links, Slack, WhatsApp), read through `channel.listByAgent` by the
 * agent's id in its own organization, and the agent's menu offers Manage
 * access as its one sharing item, with no Share item.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { openMenu } from "../../__tests__/helpers/open-menu";
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
beforeAll(() => {
  // Base UI's menu positioner observes its anchor; happy-dom lacks
  // ResizeObserver, so provide a no-op shim.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

describe("AgentDetailView's Quality tab", () => {
  it("opens to the agent's AI grading, off until switched on", async () => {
    const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
    agent.metadata = { ...agent.metadata!, labels: { "stigmer.ai/plugin": "acme/support" } };
    const getByAgent = vi.fn(async () => {
      throw new StigmerError("not-found", "no scoring rule", Code.NotFound);
    });
    render(<AgentDetailView org="acme" slug="support-bot" editable />, {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
          scoringrule: { getByAgent, create: vi.fn(), update: vi.fn() },
          score: {
            getAgentQualityReport: vi.fn(async () => emptyReport()),
            listFlaggedByAgent: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
          },
          evalrun: { listByAgent: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
          plugin: { getByReference: vi.fn(async () => undefined) },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
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
          scoringrule: {
            getByAgent: vi.fn(async () => {
              throw new StigmerError("not-found", "no scoring rule", Code.NotFound);
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
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
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

describe("AgentDetailView's Channels tab", () => {
  it("is the second tab and lists every channel of the agent, read by the agent's id in its own org", async () => {
    const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
    const chatLink = {
      metadata: { id: "ash_1", org: ACME_ID, slug: "website-chat", name: "Website chat" },
      spec: { enabled: true, type: { case: "web", value: {} } },
    };
    const slack = {
      metadata: { id: "ach_1", org: ACME_ID, slug: "support-slack", name: "Support Slack" },
      spec: { enabled: true, type: { case: "slack", value: {} } },
      status: { installState: 2, typeStatus: { case: undefined } },
    };
    const whatsapp = {
      metadata: { id: "ach_2", org: ACME_ID, slug: "support-whatsapp", name: "Support WhatsApp" },
      spec: { enabled: true, type: { case: "whatsapp", value: {} } },
      status: { installState: 2, typeStatus: { case: undefined } },
    };
    const listByAgent = vi.fn(async () => ({
      entries: [chatLink, slack, whatsapp],
      nextPageToken: "",
    }));
    render(<AgentDetailView org="acme" slug="support-bot" />, {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
          channel: { listByAgent },
          channelapp: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
          plugin: { getByReference: vi.fn(async () => undefined) },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    });
    const tabs = await screen.findAllByRole("tab");
    expect(tabs[1]?.textContent).toBe("Channels");
    expect(screen.queryByRole("tab", { name: "Shares" })).toBeNull();

    fireEvent.click(tabs[1]!);
    expect(await screen.findByText("3 channels")).toBeDefined();
    expect(
      screen.getAllByRole("group").map((card) => card.getAttribute("aria-label")),
    ).toEqual(["Chat link: Website chat", "Slack: Support Slack", "WhatsApp: Support WhatsApp"]);
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: agent.metadata!.id, org: ACME_ID }),
    );
  });
});

describe("AgentDetailView's menu", () => {
  it("offers Manage access as its one sharing item, and no Share item", async () => {
    const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
    render(<AgentDetailView org="acme" slug="support-bot" />, {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
          plugin: { getByReference: vi.fn(async () => undefined) },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
        },
        undefined,
        true,
      ),
    });

    await openMenu(await screen.findByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Manage access" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
  });
});
