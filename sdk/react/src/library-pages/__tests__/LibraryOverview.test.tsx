/**
 * Pins the Library's landing, the page both consoles render: one count card
 * per kind, each counted in the active organization by its id and going to
 * its kind's list (a plain click through the host's router, a modified one
 * left to the browser at the host's address); Apply YAML opens the manifest
 * dialog in the active organization and an apply recounts every card. The
 * Add menu offers Agent, Environment and File only to someone the server
 * lets create each (and Environment and File not until the server has
 * answered), and each item goes to its kind's create page. The count card,
 * the dialog and the checks are pinned beside their own modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

interface CardProps {
  label: string;
  count: number;
  href?: string;
  onClick?: (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number; preventDefault: () => void }) => void;
}

const page = vi.hoisted(() => ({
  canCreateAgent: { allowed: true, isLoading: false },
  canCreateEnvironment: { allowed: true, isLoading: false },
  canCreateFile: { allowed: true, isLoading: false },
  counted: [] as Array<{ org: string | null; refetchToken: unknown }>,
  cards: new Map<string, CardProps>(),
  dialog: [] as Array<{ open: boolean; org: string; onApplied: () => void }>,
  /** A count hook that records where it counted and returns `n`. */
  count: (n: number) => (org: string | null, options: { refetchToken?: unknown }) => {
    page.counted.push({ org, refetchToken: options.refetchToken });
    return { count: n, isLoading: false };
  },
}));


vi.mock("../../library/ResourceCountCard.js", () => ({
  ResourceCountCard: (props: CardProps) => {
    page.cards.set(props.label, props);
    return null;
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

import { LibraryOverview } from "../LibraryOverview";

let navigated: string[] = [];
const onNavigate = (path: string) => {
  navigated.push(path);
};

beforeEach(() => {
  page.canCreateAgent = { allowed: true, isLoading: false };
  page.canCreateEnvironment = { allowed: true, isLoading: false };
  page.canCreateFile = { allowed: true, isLoading: false };
  page.counted.length = 0;
  page.cards.clear();
  page.dialog.length = 0;
  navigated = [];
});

afterEach(cleanup);

function click(modifier = false) {
  return { metaKey: modifier, ctrlKey: false, shiftKey: false, altKey: false, button: 0, preventDefault: vi.fn() };
}

async function addMenuItems(): Promise<string[]> {
  render(<LibraryOverview onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a new resource" }));
  const items = await screen.findAllByRole("menuitem");
  return items.map((item) => item.textContent ?? "");
}

describe("LibraryOverview cards", () => {
  it("shows one count card per library kind, each counted in the active org by its id", () => {
    render(<LibraryOverview onNavigate={onNavigate} />);

    expect([...page.cards].map(([label, card]) => [label, card.count])).toEqual([
      ["Agents", 3],
      ["Skills", 5],
      ["Routines", 4],
      ["Plugins", 0],
      ["Environments", 2],
      ["Files", 7],
    ]);
    expect(page.counted).toHaveLength(6);
    expect(new Set(page.counted.map((c) => c.org))).toEqual(new Set(["org_acme"]));
  });

  it("opens each kind's list from its card on a plain click, and leaves a modified click to the browser", () => {
    render(<LibraryOverview onNavigate={onNavigate} />);

    for (const label of ["Agents", "Skills", "Routines", "Plugins", "Environments", "Files"]) {
      act(() => page.cards.get(label)?.onClick?.(click()));
    }
    expect(navigated).toEqual([
      "/library/agents",
      "/library/skills",
      "/library/routines",
      "/library/plugins",
      "/library/environments",
      "/library/files",
    ]);

    const modified = click(true);
    act(() => page.cards.get("Plugins")?.onClick?.(modified));
    expect(modified.preventDefault).not.toHaveBeenCalled();
    expect(navigated).toHaveLength(6);
  });

  it("writes each card's address the host's way", () => {
    render(<LibraryOverview onNavigate={onNavigate} toHref={(path) => `#${path}`} />);

    expect(page.cards.get("Plugins")?.href).toBe("#/library/plugins");
  });
});

describe("LibraryOverview Apply YAML", () => {
  it("opens the apply dialog in the active org, and an apply recounts every card", () => {
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
});
