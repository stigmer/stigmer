/**
 * Pins the web Conversations page's three console concerns: selection lives
 * in the path (`/conversations/<channelId>/<key>`, both segments
 * URI-encoded), the header mounts the CHANNEL's access dialog (participant
 * grants are per channel, never per conversation), and a channel links to
 * its agent's Channels tab. The workbench is pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

interface WorkbenchProps {
  org: string;
  selected: { agentChannelId: string; conversationKey: string } | null;
  onSelectionChange: (selection: { agentChannelId: string; conversationKey: string } | null) => void;
  headerAccessory?: (args: { channel: unknown }) => ReactNode;
  channelHref: (channel: unknown) => string | null;
}

const page = vi.hoisted(() => ({
  path: "/conversations",
  navigated: [] as string[],
  workbench: [] as WorkbenchProps[],
  access: [] as Array<Record<string, unknown>>,
}));

const CHANNEL = { metadata: { slug: "support" } };

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

vi.mock("@/domain/_shared/navigation/app-navigation", () => ({
  useAppNavigation: () => ({
    currentPath: page.path,
    navigate: (to: string) => page.navigated.push(to),
  }),
}));

import { ConversationsPage } from "../ConversationsPage";

beforeEach(() => {
  page.path = "/conversations";
  page.navigated.length = 0;
  page.workbench.length = 0;
  page.access.length = 0;
});

describe("web ConversationsPage", () => {
  it("reads the selection from the path and mounts that channel's access dialog", () => {
    page.path = `/conversations/${encodeURIComponent("ach_1")}/${encodeURIComponent("1712.0001")}/`;
    render(<ConversationsPage />);

    expect(page.workbench.at(-1)?.selected).toEqual({ agentChannelId: "ach_1", conversationKey: "1712.0001" });
    expect(page.access.at(-1)).toMatchObject({
      label: "Channel access",
      resource: {
        kind: ApiResourceKind.agent_channel,
        kindString: "agent_channel",
        id: "ach_1",
        org: "acme",
        name: "support",
      },
    });
  });

  it("has no selection and no access dialog on the inbox path", () => {
    render(<ConversationsPage />);

    expect(page.workbench.at(-1)?.selected).toBeNull();
    expect(page.access).toEqual([]);
  });

  it("writes a selection change into the path, encoded", () => {
    render(<ConversationsPage />);

    page.workbench.at(-1)?.onSelectionChange({ agentChannelId: "ach/2", conversationKey: "k 1" });
    page.workbench.at(-1)?.onSelectionChange(null);

    expect(page.navigated).toEqual(["/conversations/ach%2F2/k%201", "/conversations"]);
  });

  it("links a channel to its agent's Channels tab, and an agentless channel nowhere", () => {
    render(<ConversationsPage />);
    const href = page.workbench.at(-1)?.channelHref;

    expect(href?.({ spec: { agentRef: { org: "", slug: "helper" } } })).toBe("/library/agents/acme/helper?tab=channels");
    expect(href?.({ spec: {} })).toBeNull();
  });
});
