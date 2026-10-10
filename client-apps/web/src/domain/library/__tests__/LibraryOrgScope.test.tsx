/**
 * Pins where the web library scopes to the viewer's active organization by
 * its id, the way the server names every org: the landing's resource
 * counts and the MCP server page's active org (a connection is made in the
 * viewer's org); the agent page shows the agent where it lives. The views
 * and count hooks are pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  counted: [] as Array<string | null>,
  agentView: [] as Array<Record<string, unknown>>,
  mcpView: [] as Array<Record<string, unknown>>,
}));

vi.mock("@stigmer/react", () => {
  const count = (org: string | null) => {
    page.counted.push(org);
    return { count: 0, isLoading: false };
  };
  const none = () => null;
  return {
    ApplyManifestDialog: none,
    ResourceCountCard: none,
    ConfirmDialog: none,
    EditResourceYamlDialog: none,
    AgentChannelsPanel: none,
    AgentDetailView: (props: Record<string, unknown>) => {
      page.agentView.push(props);
      return null;
    },
    McpServerDetailView: (props: Record<string, unknown>) => {
      page.mcpView.push(props);
      return null;
    },
    useAgentCount: count,
    useScheduleCount: count,
    useSkillCount: count,
    useMcpServerCount: count,
    usePluginCount: count,
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => page.canCreate,
    useAgent: () => ({ agent: null, refetch: () => undefined }),
    useMcpServer: () => ({ mcpServer: null, refetch: () => undefined }),
    useCopyResource: () => ({
      copyId: () => undefined,
      copyQualifiedSlug: () => undefined,
    }),
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async () => false,
      handleConfirm: () => undefined,
      handleCancel: () => undefined,
    }),
    useDeleteResource: () => ({
      deleteResource: async () => undefined,
      isDeleting: false,
    }),
    useExportResource: () => ({
      copyYaml: () => undefined,
      copyJson: () => undefined,
      downloadYaml: () => undefined,
    }),
    useBreadcrumbOverride: () => ({ setLabel: () => undefined }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
  useRouteDetailYieldsToOverlay: () => false,
}));

vi.mock("@/config/env", () => ({
  getAppBaseUrl: () => "https://console.test",
}));

import { LibraryLanding } from "../LibraryLanding";
import { AgentDetailPageInner } from "../agents/AgentDetailPage";
import { McpServerDetailPageInner } from "../mcp-servers/McpServerDetailPage";

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.counted.length = 0;
  page.agentView.length = 0;
  page.mcpView.length = 0;
});

describe("web library org scope", () => {
  it("LibraryLanding counts every kind in the active org by its id", () => {
    render(<LibraryLanding />);

    expect(page.counted).toHaveLength(5);
    expect(new Set(page.counted)).toEqual(new Set(["org_acme"]));
  });

  it("AgentDetailPageInner shows the agent where it lives, with no instances to scope", () => {
    render(<AgentDetailPageInner org="other" slug="helper" />);

    expect(page.agentView.at(-1)).toMatchObject({ org: "other", slug: "helper" });
    expect(page.agentView.at(-1)).not.toHaveProperty("viewerOrg");
  });

  it("McpServerDetailPageInner shows the server where it lives and connects in the viewer's org id", () => {
    render(<McpServerDetailPageInner org="other" slug="github" />);

    expect(page.mcpView.at(-1)).toMatchObject({
      org: "other",
      slug: "github",
      activeOrg: "org_acme",
    });
  });
});

describe("web library Add menu — who may create agents", () => {
  async function addMenuItems(): Promise<string[]> {
    render(<LibraryLanding />);
    fireEvent.click(screen.getByRole("button", { name: "Add a new resource" }));
    const items = await screen.findAllByRole("menuitem");
    return items.map((item) => item.textContent ?? "");
  }

  it("offers Agent to someone the server lets create one", async () => {
    expect((await addMenuItems()).some((label) => label.includes("Agent"))).toBe(true);
  });

  it("leaves Agent out for someone the server would refuse, and keeps the other kinds", async () => {
    page.canCreate = { allowed: false, isLoading: false };
    const labels = await addMenuItems();
    expect(labels.some((label) => label.includes("Agent"))).toBe(false);
    expect(labels.length).toBeGreaterThan(0);
  });
});
