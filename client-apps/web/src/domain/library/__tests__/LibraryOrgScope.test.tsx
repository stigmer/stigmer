/**
 * Pins where the web library's agent page scopes: it shows the agent where
 * it lives. The landing's counts, its Apply YAML and its Add menu moved with
 * the landing into @stigmer/react-sdk/console and are pinned there
 * (`library/sections/__tests__/LibraryOverview.test.tsx`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  // The server's answer to "may this person create an environment here?".
  canCreateEnvironment: { allowed: true, isLoading: false },
  // The server's answer to "may this person upload a file here?".
  canCreateFile: { allowed: true, isLoading: false },
  counted: [] as Array<string | null>,
  agentView: [] as Array<Record<string, unknown>>,
  applyDialog: [] as Array<{ open: boolean; org: string }>,
}));

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  const count = (org: string | null) => {
    page.counted.push(org);
    return { count: 0, isLoading: false };
  };
  const none = () => null;
  return {
    Button: kit.Button,
    IconButton: kit.IconButton,
    LinkButton: kit.LinkButton,
    PageHeader: kit.PageHeader,
    ApplyManifestDialog: (props: { open: boolean; org: string }) => {
      page.applyDialog.push({ open: props.open, org: props.org });
      return null;
    },
    ResourceCountCard: none,
    ConfirmDialog: none,
    EditResourceYamlDialog: none,
    ChannelsPanel: none,
    // The journey's routes, which the agent page hands its Make it yours tab.
    useOrgSlugForId: () => (id: string) => id,
    AgentDetailView: (props: Record<string, unknown>) => {
      page.agentView.push(props);
      return null;
    },
    useAgentCount: count,
    useRoutineCount: count,
    useSkillCount: count,
    usePluginCount: count,
    useEnvironmentCount: count,
    useFileCount: count,
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => page.canCreate,
    useCanCreateEnvironment: () => page.canCreateEnvironment,
    useCanCreateFile: () => page.canCreateFile,
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

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: () => undefined }),
}));

vi.mock("@/config/env", () => ({
  getAppBaseUrl: () => "https://console.test",
}));

import { AgentDetailPageInner } from "../agents/AgentDetailPage";

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.canCreateEnvironment = { allowed: true, isLoading: false };
  page.canCreateFile = { allowed: true, isLoading: false };
  page.counted.length = 0;
  page.agentView.length = 0;
  page.applyDialog.length = 0;
});

describe("web library org scope", () => {
  it("AgentDetailPageInner shows the agent where it lives, with no instances to scope", () => {
    render(<AgentDetailPageInner org="other" slug="helper" />);

    expect(page.agentView.at(-1)).toMatchObject({ org: "other", slug: "helper" });
    expect(page.agentView.at(-1)).not.toHaveProperty("viewerOrg");
  });
});
