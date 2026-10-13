/**
 * Pins the desktop agent page's Channels tab: it appears once the agent has
 * loaded, links the in-app WhatsApp connect dialog to the channel-apps
 * settings and channel conversations to the session route (hash URLs the
 * router picks up without a reload), and hands a redirect-style connect to
 * the web console in the system browser, because the Tauri webview blocks
 * the OAuth popup. The detail view and the panel are pinned in
 * @stigmer/react.
 *
 * Also pins how the page names organizations: a referenced resource, which
 * names its org by id, opens at a URL carrying the org's slug. A share link names neither: it
 * points at the web console's `/chat/<share id>`, never the Tauri origin.
 *
 * And pins the page's own actions: Start session opens the new-session
 * screen on the agent itself (no instance to bind), and Delete warns that
 * conversations on the agent cannot continue, in the same words as the
 * agents list's row Delete, deleting only once confirmed.
 *
 * And pins how an eval try's run opens from the Evals tab: a run is viewed
 * through its parent session, so the page resolves the run first and
 * navigates to `/sessions/<id>` only once the session is known; until then
 * it stays put, as the plugin page does.
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { mockTauri } from "../../__test-utils__/tauri";
import { CONSOLE_URL } from "../../config";

interface Tab {
  id: string;
  label: string;
  content: ReactElement<PanelProps>;
}

interface PanelProps {
  agent: unknown;
  onConnectExternal: () => void;
  channelAppsHref: string;
  sessionHref: (id: string) => string;
}

interface Action {
  id: string;
  onAction: () => void | Promise<void>;
}

interface ConfirmRequest {
  title: string;
  description: string;
}

interface DetailProps {
  additionalTabs: Tab[];
  primaryAction: Action;
  actions: Action[];
  viewerOrg?: string;
  onSkillClick: (ref: { org: string; slug: string }) => void;
  onPluginClick: (ref: { org: string; slug: string }) => void;
  onAgentClick: (ref: { org: string; slug: string }) => void;
  buildShareUrl: (shareId: string) => string;
  onNavigateToRun: (runId: string) => void;
  onRenamed: (agent: { metadata?: { slug: string } }) => void;
}

const page = vi.hoisted(() => ({
  agent: undefined as unknown,
  detail: [] as DetailProps[],
  confirmed: false,
  confirmations: [] as ConfirmRequest[],
  deletes: 0,
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
}));

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const noop = () => undefined;

vi.mock("@stigmer/react", () => ({
  AgentChannelsPanel: () => null,
  AgentDetailView: (props: DetailProps) => {
    page.detail.push(props);
    return null;
  },
  EditResourceYamlDialog: () => null,
  ConfirmDialog: () => null,
  useAgent: () => ({ agent: page.agent, refetch: noop }),
  useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
  useConfirmAction: () => ({
    confirmState: null,
    confirm: async (request: ConfirmRequest) => {
      page.confirmations.push(request);
      return page.confirmed;
    },
    handleConfirm: noop,
    handleCancel: noop,
  }),
  useDeleteResource: () => ({
    deleteResource: async () => {
      page.deletes += 1;
    },
    isDeleting: false,
  }),
  useExportResource: () => ({ copyYaml: noop, copyJson: noop, downloadYaml: noop }),
  useBreadcrumbOverride: () => ({ setLabel: noop }),
  // The person's organizations: their one org reads "acme" in a URL.
  useOrgSlugForId: () => (id: string) =>
    id === "org_01jaaaaaaaaaaaaaaaaaaaaaaa" ? "acme" : id,
  useResolveRunSession: (runId: string | null) => {
    page.resolving.push(runId);
    return { sessionId: runId === null ? null : (page.sessionFor.get(runId) ?? null) };
  },
}));

import AgentDetailPage from "../library/AgentDetailPage";
import { AGENT_DELETE_DESCRIPTION } from "../library/agent-delete-confirmation";

const AGENT = { metadata: { id: "agt_1", org: ACME_ID, slug: "helper" } };

function Location() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

function renderAgent() {
  return render(
    <MemoryRouter initialEntries={["/library/agents/acme/helper"]}>
      <Routes>
        <Route path="/library/agents/:org/:slug" element={<AgentDetailPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.agent = undefined;
  page.detail.length = 0;
  page.confirmed = false;
  page.confirmations.length = 0;
  page.deletes = 0;
  page.resolving.length = 0;
  page.sessionFor.clear();
});

describe("desktop AgentDetailPage — the Channels tab", () => {
  it("is absent until the agent has loaded", () => {
    renderAgent();

    expect(page.detail.at(-1)?.additionalTabs).toEqual([]);
  });

  it("carries the loaded agent and the desktop's hash-router links", () => {
    page.agent = AGENT;
    renderAgent();

    const tabs = page.detail.at(-1)?.additionalTabs ?? [];
    expect(tabs.map((t) => [t.id, t.label])).toEqual([["channels", "Channels"]]);
    const panel = tabs[0]!.content.props;
    expect(panel.agent).toBe(AGENT);
    expect(panel.channelAppsHref).toBe("#/settings/channel-apps");
    expect(panel.sessionHref("ses_9")).toBe("#/sessions/ses_9");
  });

  it("hands a redirect-style connect to the web console in the system browser", async () => {
    const tauri = mockTauri({ open_auth_in_browser: () => undefined });
    page.agent = AGENT;
    renderAgent();

    page.detail.at(-1)?.additionalTabs[0]!.content.props.onConnectExternal();
    await vi.waitFor(() => expect(tauri.callsTo("open_auth_in_browser")).toHaveLength(1));

    expect(tauri.callsTo("open_auth_in_browser")[0]).toEqual({
      authUrl: `${CONSOLE_URL}/library/agents/acme/helper?tab=channels`,
    });
  });
});

describe("desktop AgentDetailPage — organizations", () => {
  it("passes no viewer org: an agent has no instances to scope", () => {
    page.agent = AGENT;
    renderAgent();

    expect(page.detail.at(-1)?.viewerOrg).toBeUndefined();
  });

  it("opens a referenced skill at a URL carrying its org's slug", () => {
    page.agent = AGENT;
    renderAgent();

    act(() => page.detail.at(-1)?.onSkillClick({ org: ACME_ID, slug: "triage" }));

    expect(screen.getByTestId("location").textContent).toBe("/library/skills/acme/triage");
  });

  it("opens the installing plugin at a URL carrying its org's slug", () => {
    page.agent = AGENT;
    renderAgent();

    act(() => page.detail.at(-1)?.onPluginClick({ org: ACME_ID, slug: "toolkit" }));

    expect(screen.getByTestId("location").textContent).toBe("/library/plugins/acme/toolkit");
  });

  it("opens a listed subagent at a URL carrying its org's slug", () => {
    page.agent = AGENT;
    renderAgent();

    act(() => page.detail.at(-1)?.onAgentClick({ org: ACME_ID, slug: "researcher" }));

    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/researcher");
  });

  it("builds a share link on the web console from the share's id alone", () => {
    page.agent = AGENT;
    renderAgent();

    expect(page.detail.at(-1)?.buildShareUrl("ash_01j9z3k8f2q4m6n7p8r9s0t1v2")).toBe(
      `${CONSOLE_URL}/chat/ash_01j9z3k8f2q4m6n7p8r9s0t1v2`,
    );
  });
});

describe("desktop AgentDetailPage — actions", () => {
  function action(id: string): Action {
    const found = page.detail.at(-1)?.actions.find((a) => a.id === id);
    if (found === undefined) throw new Error(`no ${id} action`);
    return found;
  }

  it("starts a session on the agent itself, with no instance to bind", () => {
    page.agent = AGENT;
    renderAgent();

    act(() => {
      void page.detail.at(-1)?.primaryAction.onAction();
    });

    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(screen.getByTestId("search").textContent).toBe("?agent=acme%2Fhelper");
  });

  it("warns that conversations on the agent cannot continue, and keeps it when declined", async () => {
    page.agent = AGENT;
    renderAgent();

    await act(async () => {
      await action("delete").onAction();
    });

    expect(page.confirmations).toHaveLength(1);
    expect(page.confirmations[0]!.description).toContain(
      "conversations on it cannot continue",
    );
    expect(page.confirmations[0]!.description).toBe(AGENT_DELETE_DESCRIPTION);
    expect(page.deletes).toBe(0);
    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper");
  });

  it("deletes the agent and returns to the list once confirmed", async () => {
    page.agent = AGENT;
    page.confirmed = true;
    renderAgent();

    await act(async () => {
      await action("delete").onAction();
    });

    expect(page.deletes).toBe(1);
    expect(screen.getByTestId("location").textContent).toBe("/library/agents");
  });
});

describe("desktop AgentDetailPage — an eval try's run", () => {
  function openRun(runId: string): void {
    const view = page.detail.at(-1);
    expect(view, "AgentDetailView was never rendered").toBeDefined();
    act(() => view!.onNavigateToRun(runId));
  }

  it("opens the run's session once it resolves", () => {
    page.agent = AGENT;
    page.sessionFor.set("run_1", "ses_1");
    renderAgent();

    openRun("run_1");

    expect(page.resolving).toContain("run_1");
    expect(screen.getByTestId("location").textContent).toBe("/sessions/ses_1");
  });

  it("stays on the agent while the run's session is not yet known", () => {
    page.agent = AGENT;
    renderAgent();

    openRun("run_unresolved");

    expect(page.resolving).toContain("run_unresolved");
    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper");
  });
});

describe("desktop AgentDetailPage — its own slug", () => {
  it("moves the route to the slug a rename from the page gave the agent", () => {
    page.agent = AGENT;
    renderAgent();

    act(() => page.detail.at(-1)?.onRenamed({ metadata: { slug: "helper-renamed" } }));

    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper-renamed");
  });
});
