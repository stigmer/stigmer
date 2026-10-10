/**
 * Pins where the web library scopes to the viewer's active organization by
 * its id, the way the server names every org: the landing's resource
 * counts; the agent page shows the agent where it lives. The views
 * and count hooks are pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  counted: [] as Array<string | null>,
  agentView: [] as Array<Record<string, unknown>>,
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
    useAgentCount: count,
    useScheduleCount: count,
    useSkillCount: count,
    usePluginCount: count,
    useActiveOrgId: () => "org_acme",
    useAgent: () => ({ agent: null, refetch: () => undefined }),
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

beforeEach(() => {
  page.counted.length = 0;
  page.agentView.length = 0;
});

describe("web library org scope", () => {
  it("LibraryLanding counts every kind in the active org by its id", () => {
    render(<LibraryLanding />);

    expect(page.counted).toHaveLength(4);
    expect(new Set(page.counted)).toEqual(new Set(["org_acme"]));
  });

  it("AgentDetailPageInner shows the agent where it lives, with no instances to scope", () => {
    render(<AgentDetailPageInner org="other" slug="helper" />);

    expect(page.agentView.at(-1)).toMatchObject({ org: "other", slug: "helper" });
    expect(page.agentView.at(-1)).not.toHaveProperty("viewerOrg");
  });
});
