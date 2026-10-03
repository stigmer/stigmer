/**
 * Pins the desktop Conversations page's wiring: the route names the selected
 * conversation, a selection change navigates the hash router, the header
 * mounts the CHANNEL's access dialog (participant grants are per channel,
 * never per conversation), and a channel links to its agent's Channels tab.
 * The workbench itself is pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

interface WorkbenchProps {
  org: string;
  selected: { agentChannelId: string; conversationKey: string } | null;
  onSelectionChange: (selection: { agentChannelId: string; conversationKey: string } | null) => void;
  headerAccessory?: (args: { channel: unknown }) => ReactNode;
  channelHref: (channel: unknown) => string | null;
}

const page = vi.hoisted(() => ({
  workbench: [] as WorkbenchProps[],
  access: [] as Array<Record<string, unknown>>,
}));

const CHANNEL = { metadata: { name: "Support line", slug: "support" } };

vi.mock("@stigmer/react", () => ({
  ConversationsWorkbench: (props: WorkbenchProps) => {
    page.workbench.push(props);
    return <>{props.headerAccessory?.({ channel: CHANNEL })}</>;
  },
  ManageAccessButton: (props: Record<string, unknown>) => {
    page.access.push(props);
    return null;
  },
  useActiveOrgSlug: () => "acme",
}));

import ConversationsPage from "../conversations/ConversationsPage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/conversations" element={<ConversationsPage />} />
        <Route path="/conversations/:channelId/:key" element={<ConversationsPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.workbench.length = 0;
  page.access.length = 0;
});

describe("desktop ConversationsPage", () => {
  it("selects the conversation its route names and mounts that channel's access dialog", () => {
    renderAt(`/conversations/${encodeURIComponent("ach_1")}/${encodeURIComponent("wa:+15550100")}`);

    const props = page.workbench.at(-1);
    expect(props?.org).toBe("acme");
    expect(props?.selected).toEqual({ agentChannelId: "ach_1", conversationKey: "wa:+15550100" });
    expect(page.access.at(-1)).toMatchObject({
      label: "Channel access",
      resource: {
        kind: ApiResourceKind.agent_channel,
        kindString: "agent_channel",
        id: "ach_1",
        org: "acme",
        name: "Support line",
      },
    });
  });

  it("mounts no access dialog until a conversation is selected", () => {
    renderAt("/conversations");

    expect(page.workbench.at(-1)?.selected).toBeNull();
    expect(page.access).toEqual([]);
  });

  it("navigates to the selected conversation and back to the inbox", () => {
    renderAt("/conversations");

    act(() => page.workbench.at(-1)?.onSelectionChange({ agentChannelId: "ach/2", conversationKey: "k 1" }));
    expect(screen.getByTestId("location").textContent).toBe("/conversations/ach%2F2/k%201");

    act(() => page.workbench.at(-1)?.onSelectionChange(null));
    expect(screen.getByTestId("location").textContent).toBe("/conversations");
  });

  it("links a channel to its agent's Channels tab, and an agentless channel nowhere", () => {
    renderAt("/conversations");
    const href = page.workbench.at(-1)?.channelHref;

    expect(href?.({ spec: { agentRef: { org: "", slug: "helper" } } })).toBe("#/library/agents/acme/helper?tab=channels");
    expect(href?.({ spec: { agentRef: { org: "other", slug: "helper" } } })).toBe("#/library/agents/other/helper?tab=channels");
    expect(href?.({ spec: {} })).toBeNull();
  });
});
