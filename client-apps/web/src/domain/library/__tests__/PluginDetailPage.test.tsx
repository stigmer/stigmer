/**
 * Pins the web plugin page's "create a new agent with these tools": it is
 * offered only to someone the server lets create an agent in the active
 * organization, and opens the new-agent page with the plugin's servers
 * preselected. The plugin view itself is pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

type CreateFromTools = (usages: Array<{ mcpServerRef: { slug: string } }>) => void;

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  asked: [] as Array<string | null>,
  view: [] as Array<{ onCreateAgent?: CreateFromTools }>,
  pushed: [] as string[],
}));

vi.mock("@stigmer/react", () => {
  const noop = () => undefined;
  return {
    PluginDetailView: (props: { onCreateAgent?: CreateFromTools }) => {
      page.view.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({ confirmState: null, confirm: noop, handleConfirm: noop, handleCancel: noop }),
    useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: (org: string | null) => {
      page.asked.push(org);
      return page.canCreate;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
  useRouteDetailYieldsToOverlay: () => false,
}));

import { PluginDetailPageInner } from "../plugins/PluginDetailPage";

function view(): { onCreateAgent?: CreateFromTools } {
  const props = page.view.at(-1);
  if (!props) throw new Error("PluginDetailView was not rendered");
  return props;
}

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.asked.length = 0;
  page.view.length = 0;
  page.pushed.length = 0;
});

describe("web PluginDetailPage — creating an agent from its tools", () => {
  it("asks about the active organization and opens the new-agent page with the plugin's servers", () => {
    render(<PluginDetailPageInner org="acme" slug="toolkit" />);

    expect(page.asked).toContain("org_acme");
    const onCreateAgent = view().onCreateAgent;
    expect(onCreateAgent).toBeDefined();
    act(() => onCreateAgent!([{ mcpServerRef: { slug: "github" } }, { mcpServerRef: { slug: "a b" } }]));

    expect(page.pushed).toEqual(["/library/agents/new?mcp=github,a%20b"]);
  });

  it("offers no create for someone the server would refuse", () => {
    page.canCreate = { allowed: false, isLoading: false };
    render(<PluginDetailPageInner org="acme" slug="toolkit" />);

    expect(view().onCreateAgent).toBeUndefined();
  });
});
