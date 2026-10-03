/**
 * Pins the desktop agent page's Channels tab: it appears once the agent has
 * loaded, links the in-app WhatsApp connect dialog to the channel-apps
 * settings and channel conversations to the session route (hash URLs the
 * router picks up without a reload), and hands a redirect-style connect to
 * the web console in the system browser, because the Tauri webview blocks
 * the OAuth popup. The detail view and the panel are pinned in
 * @stigmer/react.
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

const page = vi.hoisted(() => ({
  agent: undefined as unknown,
  detail: [] as Array<{ additionalTabs: Tab[] }>,
}));

const noop = () => undefined;

vi.mock("@stigmer/react", () => ({
  AgentChannelsPanel: () => null,
  AgentDetailView: (props: { additionalTabs: Tab[] }) => {
    page.detail.push(props);
    return null;
  },
  CreateAgentInstanceDialog: () => null,
  EditResourceYamlDialog: () => null,
  ConfirmDialog: () => null,
  useAgent: () => ({ agent: page.agent, refetch: noop }),
  useDeleteAgentInstance: () => ({ deleteInstance: noop }),
  useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
  useConfirmAction: () => ({ confirmState: null, confirm: noop, handleConfirm: noop, handleCancel: noop }),
  useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
  useExportResource: () => ({ copyYaml: noop, copyJson: noop, downloadYaml: noop }),
  useBreadcrumbOverride: () => ({ setLabel: noop }),
  useActiveOrgSlug: () => "viewer-org",
}));

import AgentDetailPage from "../library/AgentDetailPage";

const AGENT = { metadata: { id: "agt_1", org: "acme", slug: "helper" } };

function renderAgent() {
  return render(
    <MemoryRouter initialEntries={["/library/agents/acme/helper"]}>
      <Routes>
        <Route path="/library/agents/:org/:slug" element={<AgentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.agent = undefined;
  page.detail.length = 0;
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
