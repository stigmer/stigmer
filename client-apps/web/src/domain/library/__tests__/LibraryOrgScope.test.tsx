/**
 * Pins where the web library scopes to the viewer's active organization by
 * its id, the way the server names every org: the landing's resource
 * counts; the agent page shows the agent where it lives. The Add menu
 * offers Agent, Environment and File only to someone the server lets
 * create each, and Environment and File not until the server has answered. The views and
 * count hooks are pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  // The server's answer to "may this person create an environment here?".
  canCreateEnvironment: { allowed: true, isLoading: false },
  // The server's answer to "may this person upload a file here?".
  canCreateFile: { allowed: true, isLoading: false },
  counted: [] as Array<string | null>,
  agentView: [] as Array<Record<string, unknown>>,
}));

vi.mock("@stigmer/react-sdk", () => {
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
    ChannelsPanel: none,
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

import { LibraryLanding } from "../LibraryLanding";
import { AgentDetailPageInner } from "../agents/AgentDetailPage";

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.canCreateEnvironment = { allowed: true, isLoading: false };
  page.canCreateFile = { allowed: true, isLoading: false };
  page.counted.length = 0;
  page.agentView.length = 0;
});

describe("web library org scope", () => {
  it("LibraryLanding counts every kind in the active org by its id", () => {
    render(<LibraryLanding />);

    expect(page.counted).toHaveLength(6);
    expect(new Set(page.counted)).toEqual(new Set(["org_acme"]));
  });

  it("AgentDetailPageInner shows the agent where it lives, with no instances to scope", () => {
    render(<AgentDetailPageInner org="other" slug="helper" />);

    expect(page.agentView.at(-1)).toMatchObject({ org: "other", slug: "helper" });
    expect(page.agentView.at(-1)).not.toHaveProperty("viewerOrg");
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

describe("web library Add menu — who may create environments", () => {
  async function addMenuItems(): Promise<string[]> {
    render(<LibraryLanding />);
    fireEvent.click(screen.getByRole("button", { name: "Add a new resource" }));
    const items = await screen.findAllByRole("menuitem");
    return items.map((item) => item.textContent ?? "");
  }

  it("offers Environment to an admin", async () => {
    expect(await addMenuItems()).toContain("Environment");
  });

  it("leaves Environment out for someone the server would refuse (a member, or anyone before it answers)", async () => {
    page.canCreateEnvironment = { allowed: false, isLoading: false };
    expect(await addMenuItems()).not.toContain("Environment");
  });
});

describe("web library Add menu — who may upload files", () => {
  async function addMenuItems(): Promise<string[]> {
    render(<LibraryLanding />);
    fireEvent.click(screen.getByRole("button", { name: "Add a new resource" }));
    const items = await screen.findAllByRole("menuitem");
    return items.map((item) => item.textContent ?? "");
  }

  it("offers File, which opens the Files page, to whoever may upload one", async () => {
    expect(await addMenuItems()).toContain("File");
    expect(screen.getByRole("menuitem", { name: "File" }).getAttribute("href")).toBe("/library/files");
  });

  it("leaves File out for someone the server would refuse (or anyone before it answers)", async () => {
    page.canCreateFile = { allowed: false, isLoading: false };
    expect(await addMenuItems()).not.toContain("File");
  });
});
