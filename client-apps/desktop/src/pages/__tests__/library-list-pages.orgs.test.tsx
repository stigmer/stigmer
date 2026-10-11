/**
 * Pins how the desktop library list pages (agents, skills, plugins) name
 * organizations. A listed resource names its
 * organization by id: the list is scoped to the active organization's id,
 * the Organization column renders that id through `OrgSlugText` (which shows
 * the slug), and every way out of a row (opening it, View details, Copy ID)
 * carries the slug of the resource's own organization, never the id and
 * never the active organization's slug. The plugins list's "Add MCP
 * server" adds in the active organization and opens the new plugin at its
 * organization's slug. A
 * row's Delete on the agents list confirms in the words of
 * that resource's detail page, the same confirmation for the same act. The
 * workbench, the action menu and the dialogs are pinned in @stigmer/react.
 */
import type { ComponentType, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface Item {
  id: string;
  org: string;
  slug: string;
  name: string;
  description: string;
}

interface Column {
  id: string;
  cell: (item: Item) => ReactNode;
}

interface WorkbenchProps {
  org: string;
  columns: Column[];
  onItemClick: (item: Item) => void;
  renderItemAction?: (item: Item) => ReactNode;
  headerAction?: ReactNode;
  emptyAction?: ReactNode;
}

interface AddServerDialogProps {
  org: string;
  open: boolean;
  onAdded: (plugin: { metadata: { org: string; slug: string } }) => void;
}

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  workbench: [] as WorkbenchProps[],
  addServer: [] as AddServerDialogProps[],
  confirms: [] as Array<{ title: string; description: string }>,
  // A resource shared into the viewer's library from another organization:
  // its org id resolves to that organization's slug, not the active one's.
  item: {
    id: "res_1",
    org: "org_shared",
    slug: "triage",
    name: "Triage",
    description: "",
  },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@stigmer/react", () => {
  const ActionMenu = Object.assign(
    ({ children }: { children: ReactNode }) => <>{children}</>,
    {
      Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Item: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
        <button type="button" onClick={onSelect}>
          {children}
        </button>
      ),
      Separator: () => null,
    },
  );
  const noop = () => undefined;
  const resourceClient = { list: noop, delete: noop };
  return {
    ActionMenu,
    ResourceWorkbench: (props: WorkbenchProps) => {
      page.workbench.push(props);
      return (
        <div>
          {props.columns.map((column) => (
            <div key={column.id} data-testid={`cell-${column.id}`}>
              {column.cell(page.item)}
            </div>
          ))}
          <button type="button" onClick={() => props.onItemClick(page.item)}>
            open row
          </button>
          {props.renderItemAction?.(page.item)}
        </div>
      );
    },
    OrgSlugText: ({ orgId }: { orgId: string }) => <span data-org-id={orgId} />,
    AddMcpServerDialog: (props: AddServerDialogProps) => {
      page.addServer.push(props);
      return null;
    },
    ApplyManifestDialog: () => null,
    ConfirmDialog: () => null,
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (options: { title: string; description: string }) => {
        page.confirms.push(options);
        return false;
      },
      handleConfirm: noop,
      handleCancel: noop,
    }),
    useStigmer: () => ({
      agent: resourceClient,
      skill: resourceClient,
      plugin: resourceClient,
    }),
    toast,
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => page.canCreate,
    // The person's organizations: the active one and the one sharing the row.
    useOrgSlugForId: () => (id: string) =>
      ({ org_acme: "acme", org_shared: "shared-team" })[id] ?? id,
  };
});

import AgentListPage from "../library/AgentListPage";
import SkillListPage from "../library/SkillListPage";
import PluginListPage from "../library/PluginListPage";
import { AGENT_DELETE_DESCRIPTION } from "../library/agent-delete-confirmation";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage(Page: ComponentType) {
  return render(
    <MemoryRouter initialEntries={["/library"]}>
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.workbench.length = 0;
  page.addServer.length = 0;
  page.confirms.length = 0;
  toast.success.mockClear();
});

const MENU_PAGES: ReadonlyArray<{ name: string; Page: ComponentType; segment: string; copied: string }> = [
  { name: "AgentListPage", Page: AgentListPage, segment: "agents", copied: "Copied agent ID" },
  { name: "SkillListPage", Page: SkillListPage, segment: "skills", copied: "Copied skill ID" },
  { name: "PluginListPage", Page: PluginListPage, segment: "plugins", copied: "Copied plugin ID" },
];

describe.each(MENU_PAGES)("desktop $name — organizations", ({ Page, segment, copied }) => {
  it("lists the active organization by id and shows each row's org through OrgSlugText", () => {
    renderPage(Page);

    expect(page.workbench.at(-1)?.org).toBe("org_acme");
    expect(screen.getByTestId("cell-org").querySelector("[data-org-id]")?.getAttribute("data-org-id")).toBe(
      "org_shared",
    );
  });

  it("opens a row at a URL carrying its own organization's slug", () => {
    renderPage(Page);

    fireEvent.click(screen.getByRole("button", { name: "open row" }));

    expect(location()).toBe(`/library/${segment}/shared-team/triage`);
  });

  it("opens View details at the same slug URL", () => {
    renderPage(Page);

    fireEvent.click(screen.getByRole("button", { name: /View details/ }));

    expect(location()).toBe(`/library/${segment}/shared-team/triage`);
  });

  it("copies the reference with the organization's slug", () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderPage(Page);

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    expect(writeText).toHaveBeenCalledWith("shared-team/triage");
    expect(toast.success).toHaveBeenCalledWith(copied);
    writeText.mockRestore();
  });
});

describe.each([
  { name: "AgentListPage", Page: AgentListPage, description: AGENT_DELETE_DESCRIPTION },
])("desktop $name — delete", ({ Page, description }) => {
  it("confirms a row's delete in the detail page's words, naming the resource alone", () => {
    renderPage(Page);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(page.confirms).toHaveLength(1);
    expect(page.confirms[0]!.description).toBe(description);
    expect(page.confirms[0]!.description).not.toMatch(/instance/);
  });
});

describe("desktop PluginListPage — Add MCP server", () => {
  it("adds the server in the active organization by id, closed until asked", () => {
    renderPage(PluginListPage);

    expect(page.addServer.at(-1)).toMatchObject({ org: "org_acme", open: false });
  });

  it("opens the new plugin at a URL carrying its organization's slug", () => {
    renderPage(PluginListPage);

    act(() => page.addServer.at(-1)?.onAdded({ metadata: { org: "org_shared", slug: "linear" } }));

    expect(location()).toBe("/library/plugins/shared-team/linear");
  });
});

describe("desktop AgentListPage — who may create agents", () => {
  function renderActions() {
    const props = page.workbench.at(-1);
    if (!props) throw new Error("the workbench was not rendered");
    return render(
      <MemoryRouter>
        {props.headerAction}
        {props.emptyAction}
      </MemoryRouter>,
    );
  }

  it("offers Create agent in the header and the empty list to someone the server lets create one", () => {
    renderPage(AgentListPage);
    const { getAllByRole } = renderActions();

    expect(getAllByRole("link", { name: "Create agent" })).toHaveLength(2);
  });

  it("offers no Create agent to someone the server would refuse", () => {
    page.canCreate = { allowed: false, isLoading: false };
    renderPage(AgentListPage);
    const { queryByRole } = renderActions();

    expect(queryByRole("link", { name: "Create agent" })).toBeNull();
    expect(page.workbench.at(-1)?.emptyAction).toBeUndefined();
  });
});
