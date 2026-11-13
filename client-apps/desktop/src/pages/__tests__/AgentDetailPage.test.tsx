/**
 * Pins what the desktop agent page hands the view's Channels tab: the page
 * adds no tab of its own (the view builds Channels in its second slot), and
 * passes its routing seams: the in-app WhatsApp connect dialog links to the
 * channel-apps settings and channel conversations to the session route
 * (hash URLs the router picks up without a reload), and a redirect-style
 * connect is handed to the web console's Channels tab in the system
 * browser, because the Tauri webview blocks the OAuth popup. The detail
 * view and the panel are pinned in @stigmer/react-sdk.
 *
 * Also pins how the page names organizations: a referenced resource, which
 * names its org by id, opens at a URL carrying the org's slug. A chat link
 * names neither: it points at the web console's `/chat/<channel id>`,
 * never the Tauri origin.
 *
 * And pins the page's own actions: Start session opens the new-session
 * screen on the agent itself (no instance to bind), and Delete warns that
 * conversations on the agent cannot continue, in the same words as the
 * agents list's row Delete, deleting only once confirmed. The page holds no
 * copy of the agent: the view owns the actions that read it
 * (`yamlActions`, stigmer/stigmer#2813), and the route follows the slug the
 * view reports on each load, a YAML apply's rename included. Delete
 * declares the relation it needs (CON-01), as the web page's does, so the
 * view offers it only on the server's yes; the view's own Edit YAML
 * declares `can_edit` (pinned in @stigmer/react-sdk).
 *
 * And pins the journey's tab: the page offers the view's "Make it yours"
 * tab with the app's routes, opens on the tab a `?tab=` link names (as the
 * web page does), and moves to the tab a later link names.
 *
 * And pins how an eval try's run opens from the Evals tab: a run is viewed
 * through its parent session, so the page resolves the run first and
 * navigates to `/sessions/<id>` only once the session is known; until then
 * it stays put, as the plugin page does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { mockTauri } from "../../__test-utils__/tauri";
import { CONSOLE_URL } from "../../config";

interface Action {
  id: string;
  requires?: string;
  onAction: () => void | Promise<void>;
}

interface ConfirmRequest {
  title: string;
  description: string;
}

interface DetailProps {
  additionalTabs?: unknown;
  channelAppsHref: string;
  sessionHref: (id: string) => string;
  onConnectExternal: (channel: unknown) => void;
  primaryAction: Action;
  actions: Action[];
  viewerOrg?: string;
  onSkillClick: (ref: { org: string; slug: string }) => void;
  onPluginClick: (ref: { org: string; slug: string }) => void;
  onAgentClick: (ref: { org: string; slug: string }) => void;
  buildChatLinkUrl: (channelId: string) => string;
  onNavigateToRun: (runId: string) => void;
  onRenamed: (agent: { metadata?: { slug: string } }) => void;
  onResourceLoad: (meta: { name: string; id: string; slug: string }) => void;
  yamlActions?: boolean;
  inApp?: { serviceAccounts?: string; embedding?: string };
  makeItYours?: { launch: (input: { agent: { org: string; slug: string }; example: string | undefined; mode: "sample" | "own" }) => string };
  activeTab?: string;
}

const page = vi.hoisted(() => ({
  detail: [] as DetailProps[],
  confirmed: false,
  confirmations: [] as ConfirmRequest[],
  deletes: 0,
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
}));

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const noop = () => undefined;

vi.mock("@stigmer/react-sdk", () => ({
  AgentDetailView: (props: DetailProps) => {
    page.detail.push(props);
    return null;
  },
  ConfirmDialog: () => null,
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

/** The view's report of a load of the agent, answering `slug`. */
function loaded(slug: string): void {
  act(() => page.detail.at(-1)?.onResourceLoad({ name: "Helper", id: "agt_1", slug }));
}

function Location() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

let navigateTo: ((to: string) => void) | undefined;
function Navigator() {
  const navigate = useNavigate();
  navigateTo = navigate;
  return null;
}

function renderAgent(path = "/library/agents/acme/helper") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <Routes>
        <Route path="/library/agents/:org/:slug" element={<AgentDetailPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.detail.length = 0;
  page.confirmed = false;
  page.confirmations.length = 0;
  page.deletes = 0;
  page.resolving.length = 0;
  page.sessionFor.clear();
});

describe("desktop AgentDetailPage — the journey's tab", () => {
  it("offers the view's Make it yours tab, with the app's launcher route", () => {
    renderAgent();

    expect(page.detail.at(-1)?.makeItYours?.launch({ agent: { org: ACME_ID, slug: "helper" }, example: "variance-report", mode: "own" })).toBe(
      // The organization is written as its slug, as every app address names one.
      `/?agent=${encodeURIComponent("acme/helper")}&example=variance-report&with=own`,
    );
  });

  it("offers the view's In your app tab, with the app's settings routes", () => {
    renderAgent();

    expect(page.detail.at(-1)?.inApp).toMatchObject({ serviceAccounts: "/settings/service-accounts", embedding: "/settings/org-embedding" });
  });

  it("opens on the tab a link names, and moves to the tab a later link names", () => {
    renderAgent("/library/agents/acme/helper?tab=make-it-yours");
    expect(page.detail.at(-1)?.activeTab).toBe("make-it-yours");

    act(() => navigateTo?.("/library/agents/acme/helper?tab=channels"));
    expect(page.detail.at(-1)?.activeTab).toBe("channels");
  });

  it("opens on Overview when no link names a tab", () => {
    renderAgent();
    expect(page.detail.at(-1)?.activeTab).toBe("overview");
  });
});

describe("desktop AgentDetailPage — the Channels tab", () => {
  it("adds no tab of its own, before or after the agent loads: the view builds Channels", () => {
    renderAgent();
    expect(page.detail.at(-1)?.additionalTabs).toBeUndefined();

    loaded("helper");
    expect(page.detail.at(-1)?.additionalTabs).toBeUndefined();
  });

  it("passes the view the desktop's hash-router links", () => {
    renderAgent();

    const view = page.detail.at(-1);
    expect(view?.channelAppsHref).toBe("#/settings/channel-apps");
    expect(view?.sessionHref("ses_9")).toBe("#/sessions/ses_9");
  });

  it("hands a redirect-style connect to the web console in the system browser", async () => {
    const tauri = mockTauri({ open_auth_in_browser: () => undefined });
    renderAgent();

    page.detail.at(-1)?.onConnectExternal(null);
    await vi.waitFor(() => expect(tauri.callsTo("open_auth_in_browser")).toHaveLength(1));

    expect(tauri.callsTo("open_auth_in_browser")[0]).toEqual({
      authUrl: `${CONSOLE_URL}/library/agents/acme/helper?tab=channels`,
    });
  });
});

describe("desktop AgentDetailPage — organizations", () => {
  it("passes no viewer org: an agent has no instances to scope", () => {
    renderAgent();

    expect(page.detail.at(-1)?.viewerOrg).toBeUndefined();
  });

  it("opens a referenced skill at a URL carrying its org's slug", () => {
    renderAgent();

    act(() => page.detail.at(-1)?.onSkillClick({ org: ACME_ID, slug: "triage" }));

    expect(screen.getByTestId("location").textContent).toBe("/library/skills/acme/triage");
  });

  it("opens the installing plugin at a URL carrying its org's slug", () => {
    renderAgent();

    act(() => page.detail.at(-1)?.onPluginClick({ org: ACME_ID, slug: "toolkit" }));

    expect(screen.getByTestId("location").textContent).toBe("/library/plugins/acme/toolkit");
  });

  it("opens a listed subagent at a URL carrying its org's slug", () => {
    renderAgent();

    act(() => page.detail.at(-1)?.onAgentClick({ org: ACME_ID, slug: "researcher" }));

    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/researcher");
  });

  it("builds a chat link on the web console from the channel's id alone", () => {
    renderAgent();

    expect(page.detail.at(-1)?.buildChatLinkUrl("chn_01j9z3k8f2q4m6n7p8r9s0t1v2")).toBe(
      `${CONSOLE_URL}/chat/chn_01j9z3k8f2q4m6n7p8r9s0t1v2`,
    );
  });
});

describe("desktop AgentDetailPage — actions", () => {
  function action(id: string): Action {
    const found = page.detail.at(-1)?.actions.find((a) => a.id === id);
    if (found === undefined) throw new Error(`no ${id} action`);
    return found;
  }

  it("CON-01 declares can_delete on Delete, and nothing on Start session or the copies", () => {
    renderAgent();

    const declared = Object.fromEntries((page.detail.at(-1)?.actions ?? []).map((a) => [a.id, a.requires ?? null]));
    expect(declared).toEqual({ "copy-id": null, "copy-slug": null, delete: "can_delete" });
    expect(page.detail.at(-1)?.primaryAction.requires).toBeUndefined();
  });

  it("leaves the actions that read the agent to the view, and passes only its own", () => {
    renderAgent();

    expect(page.detail.at(-1)?.yamlActions).toBe(true);
    expect(page.detail.at(-1)?.actions.map((a) => a.id)).toEqual(["copy-id", "copy-slug", "delete"]);
  });

  it("starts a session on the agent itself, with no instance to bind", () => {
    renderAgent();

    act(() => {
      void page.detail.at(-1)?.primaryAction.onAction();
    });

    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(screen.getByTestId("search").textContent).toBe("?agent=acme%2Fhelper");
  });

  it("warns that conversations on the agent cannot continue, and keeps it when declined", async () => {
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
    page.sessionFor.set("run_1", "ses_1");
    renderAgent();

    openRun("run_1");

    expect(page.resolving).toContain("run_1");
    expect(screen.getByTestId("location").textContent).toBe("/sessions/ses_1");
  });

  it("stays on the agent while the run's session is not yet known", () => {
    renderAgent();

    openRun("run_unresolved");

    expect(page.resolving).toContain("run_unresolved");
    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper");
  });
});

describe("desktop AgentDetailPage — its own slug", () => {
  it("leaves the route alone while the agent answers the route's slug", () => {
    renderAgent();
    loaded("helper");

    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper");
  });

  it("moves the route to the slug the agent answers to now, a YAML apply's rename included", () => {
    renderAgent();
    loaded("helper-desk");

    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper-desk");
  });

  it("moves the route to the slug a rename from the page gave the agent", () => {
    renderAgent();

    act(() => page.detail.at(-1)?.onRenamed({ metadata: { slug: "helper-renamed" } }));

    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper-renamed");
  });
});
