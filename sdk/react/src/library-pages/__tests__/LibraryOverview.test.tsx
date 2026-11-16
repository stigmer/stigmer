/**
 * Pins the Library's landing, the page both consoles render: one row per
 * kind, saying what it is for and its count (counted in the active
 * organization by its id), each going to its kind's list (a plain click
 * through the host's router, a modified one left to the browser at the
 * host's address); a count that fails says so and its row still opens.
 * Apply YAML opens the manifest dialog in the active organization and an
 * apply recounts every row. The Add menu offers Agent, Skill, Environment,
 * File and the plugin items only to someone the server lets create each
 * (and not until the server has answered), and each item goes to its kind's
 * create page. The dialog and the checks are pinned beside their own
 * modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const page = vi.hoisted(() => ({
  canCreateAgent: { allowed: true, isLoading: false },
  canCreateEnvironment: { allowed: true, isLoading: false },
  canCreateFile: { allowed: true, isLoading: false },
  canCreateSkill: { allowed: true, isLoading: false },
  canCreatePlugin: { allowed: true, isLoading: false },
  /** The count hooks that fail, by the count they would return. */
  failing: new Set<number>(),
  counted: [] as Array<{ org: string | null; refetchToken: unknown }>,
  dialog: [] as Array<{ open: boolean; org: string; onApplied: () => void }>,
  /** A count hook that records where it counted and returns `n`. */
  count: (n: number) => (org: string | null, options: { refetchToken?: unknown }) => {
    page.counted.push({ org, refetchToken: options.refetchToken });
    return page.failing.has(n)
      ? { count: 0, isLoading: false, error: new Error("count failed") }
      : { count: n, isLoading: false, error: null };
  },
}));


vi.mock("../../manifest/ApplyManifestDialog.js", () => ({
  ApplyManifestDialog: (props: { open: boolean; org: string; onApplied: () => void }) => {
    page.dialog.push(props);
    return null;
  },
}));
vi.mock("../../organization/OrgProvider.js", async () => ({
  ...(await vi.importActual<typeof import("../../organization/OrgProvider.js")>("../../organization/OrgProvider.js")),
  useActiveOrgId: () => "org_acme",
}));
vi.mock("../../agent/useAgentCount.js", () => ({ useAgentCount: page.count(3) }));
vi.mock("../../skill/useSkillCount.js", () => ({ useSkillCount: page.count(5) }));
vi.mock("../../routine/useRoutineCount.js", () => ({ useRoutineCount: page.count(4) }));
vi.mock("../../plugin/usePluginList.js", async () => ({
  ...(await vi.importActual<typeof import("../../plugin/usePluginList.js")>("../../plugin/usePluginList.js")),
  usePluginCount: page.count(0),
}));
vi.mock("../../environment/useEnvironmentCount.js", () => ({ useEnvironmentCount: page.count(2) }));
vi.mock("../../file/useFileCount.js", () => ({ useFileCount: page.count(7) }));
vi.mock("../../agent/useCanCreateAgent.js", () => ({ useCanCreateAgent: () => page.canCreateAgent }));
vi.mock("../../environment/useCanCreateEnvironment.js", () => ({
  useCanCreateEnvironment: () => page.canCreateEnvironment,
}));
vi.mock("../../file/useCanCreateFile.js", () => ({ useCanCreateFile: () => page.canCreateFile }));
vi.mock("../../skill/useCanCreateSkill.js", () => ({ useCanCreateSkill: () => page.canCreateSkill }));
vi.mock("../../plugin/useCanCreatePlugin.js", () => ({ useCanCreatePlugin: () => page.canCreatePlugin }));

import { LibraryOverview } from "../LibraryOverview";

let navigated: string[] = [];
const onNavigate = (path: string) => {
  navigated.push(path);
};

beforeEach(() => {
  page.canCreateAgent = { allowed: true, isLoading: false };
  page.canCreateEnvironment = { allowed: true, isLoading: false };
  page.canCreateFile = { allowed: true, isLoading: false };
  page.canCreateSkill = { allowed: true, isLoading: false };
  page.canCreatePlugin = { allowed: true, isLoading: false };
  page.failing.clear();
  page.counted.length = 0;
  page.dialog.length = 0;
  navigated = [];
});

afterEach(cleanup);

async function addMenuItems(): Promise<string[]> {
  render(<LibraryOverview onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a new resource" }));
  const items = await screen.findAllByRole("menuitem");
  return items.map((item) => item.textContent ?? "");
}

describe("LibraryOverview rows", () => {
  it("shows one row per kind with what it is for and its count, each counted in the active org by its id", () => {
    render(<LibraryOverview onNavigate={onNavigate} />);

    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([
      "AgentsThe jobs your organization hands off.3",
      "SkillsKnow-how an agent loads when a task needs it.5",
      "PluginsInstalled bundles of skills, agents and tools.0",
      "RoutinesAgents started on a schedule or from another system.4",
      "EnvironmentsPackages and network for your agents' sandboxes.2",
      "FilesFiles you keep for your routines to use.7",
    ]);
    expect(page.counted).toHaveLength(6);
    expect(new Set(page.counted.map((c) => c.org))).toEqual(new Set(["org_acme"]));
  });

  it("opens each kind's list from its row on a plain click, and leaves a modified click to the browser", () => {
    render(<LibraryOverview onNavigate={onNavigate} />);

    for (const name of ["Agents", "Skills", "Plugins", "Routines", "Environments", "Files"]) {
      fireEvent.click(screen.getByRole("link", { name }));
    }
    expect(navigated).toEqual([
      "/library/agents",
      "/library/skills",
      "/library/plugins",
      "/library/routines",
      "/library/environments",
      "/library/files",
    ]);

    fireEvent.click(screen.getByRole("link", { name: "Plugins" }), { metaKey: true });
    expect(navigated).toHaveLength(6);
  });

  it("writes each row's address the host's way", () => {
    render(<LibraryOverview onNavigate={onNavigate} toHref={(path) => `#${path}`} />);

    expect(screen.getByRole("link", { name: "Plugins" }).getAttribute("href")).toBe("#/library/plugins");
  });

  it("says a count didn't load, and its row still opens", () => {
    page.failing.add(4);
    render(<LibraryOverview onNavigate={onNavigate} />);

    const routines = screen.getByRole("link", { name: "Routines" }).closest("li");
    expect(routines?.textContent).toContain("Count didn\u2019t load");
    fireEvent.click(screen.getByRole("link", { name: "Routines" }));
    expect(navigated).toEqual(["/library/routines"]);
  });
});

describe("LibraryOverview Apply YAML", () => {
  it("opens the apply dialog in the active org, and an apply recounts every row", () => {
    render(<LibraryOverview onNavigate={onNavigate} />);
    expect(page.dialog.at(-1)).toMatchObject({ open: false, org: "org_acme" });

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.dialog.at(-1)?.open).toBe(true);

    page.counted.length = 0;
    act(() => page.dialog.at(-1)?.onApplied());
    expect(page.counted.map((c) => c.refetchToken)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe("LibraryOverview Add menu: who may create agents", () => {
  it("offers Agent to someone the server lets create one", async () => {
    expect((await addMenuItems()).some((label) => label.includes("Agent"))).toBe(true);
  });

  it("leaves Agent out for someone the server would refuse, and keeps the other kinds", async () => {
    page.canCreateAgent = { allowed: false, isLoading: false };
    const labels = await addMenuItems();
    expect(labels.some((label) => label.includes("Agent"))).toBe(false);
    expect(labels.length).toBeGreaterThan(0);
  });
});

describe("LibraryOverview Add menu: who may create environments", () => {
  it("offers Environment to an admin", async () => {
    expect(await addMenuItems()).toContain("Environment");
  });

  it("leaves Environment out for someone the server would refuse (a member, or anyone before it answers)", async () => {
    page.canCreateEnvironment = { allowed: false, isLoading: false };
    expect(await addMenuItems()).not.toContain("Environment");
  });
});

describe("LibraryOverview Add menu: who may upload files", () => {
  it("offers File, which opens the Files page, to whoever may upload one", async () => {
    expect(await addMenuItems()).toContain("File");
    expect(screen.getByRole("menuitem", { name: "File" }).getAttribute("href")).toBe("/library/files");
  });

  it("leaves File out for someone the server would refuse (or anyone before it answers)", async () => {
    page.canCreateFile = { allowed: false, isLoading: false };
    expect(await addMenuItems()).not.toContain("File");
  });
});

describe("LibraryOverview Add menu: where each item goes", () => {
  it("goes to the kind's create page through the host's router, and the MCP server item opens the Plugins list's form", async () => {
    await addMenuItems();

    expect(screen.getByRole("menuitem", { name: "MCP server" }).getAttribute("href")).toBe("/library/plugins?add=mcp-server");
    fireEvent.click(screen.getByRole("menuitem", { name: "Routine" }));

    expect(navigated).toEqual(["/library/routines/new"]);
  });

  it("writes each item's address the host's way", async () => {
    render(<LibraryOverview onNavigate={onNavigate} toHref={(path) => `#${path}`} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a new resource" }));

    expect((await screen.findByRole("menuitem", { name: "Routine" })).getAttribute("href")).toBe("#/library/routines/new");
  });

  it("leaves a modified click on an item to the browser", async () => {
    await addMenuItems();

    fireEvent.click(screen.getByRole("menuitem", { name: "Routine" }), { metaKey: true });

    expect(navigated).toEqual([]);
  });
});

describe("LibraryOverview Add menu: who may upload skills and install plugins", () => {
  it("offers Skill, Upload plugin and MCP server to an admin, plugins after a separator", async () => {
    const labels = await addMenuItems();
    expect(labels).toEqual(["Agent", "Skill", "Routine", "Environment", "File", "Upload plugin", "MCP server"]);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("CON-01 leaves Skill and the plugin items out for someone the server would refuse", async () => {
    page.canCreateSkill = { allowed: false, isLoading: false };
    page.canCreatePlugin = { allowed: false, isLoading: false };
    const labels = await addMenuItems();
    expect(labels).toEqual(["Agent", "Routine", "Environment", "File"]);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("is the page's labelled Add button", () => {
    render(<LibraryOverview onNavigate={onNavigate} />);
    expect(screen.getByRole("button", { name: "Add a new resource" }).textContent).toBe("Add");
  });
});
