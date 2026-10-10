/**
 * Pins the web library's list pages: each lists the active organization by
 * its id, the way the server names every org; a row's Organization column
 * shows the org the stored resource names by id through OrgSlugText (its
 * slug, never the raw id); and a row's "Copy ID" copies the
 * `<org slug>/<slug>` reference a person types elsewhere. A row's Delete on
 * the agents list confirms in the agent detail page's words, the same
 * confirmation for the same act. The plugins list offers "Add MCP server"
 * in the active organization, open on arrival through `?add=mcp-server`
 * (the Library's Add menu), and goes to the new plugin's page. The
 * workbench, OrgSlugText and the form are pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

interface ColumnDef {
  id: string;
  cell: (item: Row) => ReactNode;
}

interface Row {
  id: string;
  org: string;
  slug: string;
  name: string;
}

interface WorkbenchProps {
  org: string | null;
  columns: ColumnDef[];
  renderItemAction?: (item: Row) => ReactNode;
}

const ROW: Row = { id: "agt_1", org: "org_acme", slug: "kit", name: "Kit" };

const page = vi.hoisted(() => ({
  workbench: [] as WorkbenchProps[],
  addServer: [] as Array<Record<string, unknown>>,
  detail: [] as Array<{ type: string; org: string; slug: string }>,
  search: new URLSearchParams(),
  confirms: [] as Array<{ title: string; description: string }>,
}));

vi.mock("@stigmer/react", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  );
  const ActionMenu = Object.assign(Passthrough, {
    Trigger: () => null,
    Content: Passthrough,
    Separator: () => null,
    Item: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect: () => void;
    }) => (
      <button type="button" onClick={onSelect}>
        {children}
      </button>
    ),
  });
  const kind = {
    list: async () => ({ items: [] }),
    delete: async () => undefined,
  };
  return {
    ResourceWorkbench: (props: WorkbenchProps) => {
      page.workbench.push(props);
      // Render one row the way the workbench does: each column's cell,
      // then the row's action slot.
      return (
        <div>
          {props.columns.map((column) => (
            <div key={column.id} data-column={column.id}>
              {column.cell(ROW)}
            </div>
          ))}
          {props.renderItemAction?.(ROW)}
        </div>
      );
    },
    ActionMenu,
    ApplyManifestDialog: () => null,
    ConfirmDialog: () => null,
    AddMcpServerDialog: (props: Record<string, unknown>) => {
      page.addServer.push(props);
      return null;
    },
    // A stand-in that shows which org id the column handed it.
    OrgSlugText: ({ orgId }: { orgId: string }) => <span>slug of {orgId}</span>,
    ScheduleRowActions: () => null,
    createScheduleColumns: () => [],
    createScheduleListFn: () => kind.list,
    useStigmer: () => ({
      agent: kind,
      skill: kind,
      plugin: kind,
    }),
    useActiveOrgId: () => "org_acme",
    // The person's organizations: org_acme reads "acme".
    useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (options: { title: string; description: string }) => {
        page.confirms.push(options);
        return false;
      },
      handleConfirm: () => undefined,
      handleCancel: () => undefined,
    }),
    toast: { success: () => undefined, error: () => undefined },
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => page.search,
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: (type: string, org: string, slug: string) => {
      page.detail.push({ type, org, slug });
    },
  }),
}));

import { AgentListPage } from "../agents/AgentListPage";
import { PluginListPage } from "../plugins/PluginListPage";
import { ScheduleListPage } from "../schedules/ScheduleListPage";
import { SkillListPage } from "../skills/SkillListPage";
import { AGENT_DELETE_DESCRIPTION } from "../agents/agent-delete-confirmation";

let copied: string[] = [];

beforeEach(() => {
  page.workbench.length = 0;
  page.addServer.length = 0;
  page.detail.length = 0;
  page.search = new URLSearchParams();
  page.confirms.length = 0;
  copied = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    async (text: string) => {
      copied.push(text);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function orgCell(): HTMLElement {
  const cell = document.querySelector<HTMLElement>('[data-column="org"]');
  if (!cell) throw new Error("no Organization column");
  return cell;
}

describe.each([
  { name: "AgentListPage", Page: AgentListPage },
  { name: "SkillListPage", Page: SkillListPage },
  { name: "PluginListPage", Page: PluginListPage },
])("web $name", ({ Page }) => {
  it("lists the active org by its id", () => {
    render(<Page />);

    expect(page.workbench.at(-1)?.org).toBe("org_acme");
  });

  it("shows a row's org through OrgSlugText, from the id the row names it by", () => {
    render(<Page />);

    expect(orgCell().textContent).toBe("slug of org_acme");
  });

  it("copies the row's reference under its org's slug", () => {
    render(<Page />);

    fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));

    expect(copied).toEqual(["acme/kit"]);
  });
});

describe("web AgentListPage delete", () => {
  it("confirms in the detail page's words, naming the agent alone", () => {
    render(<AgentListPage />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(page.confirms).toHaveLength(1);
    expect(page.confirms[0]!.description).toBe(AGENT_DELETE_DESCRIPTION);
    expect(page.confirms[0]!.description).not.toMatch(/instance/);
  });
});

describe("web PluginListPage Add MCP server", () => {
  it("adds the server in the active org by its id, closed until asked", () => {
    render(<PluginListPage />);

    expect(page.addServer.at(-1)).toMatchObject({ org: "org_acme", open: false });
  });

  it("opens on arrival from the Library's Add menu", () => {
    page.search = new URLSearchParams("add=mcp-server");
    render(<PluginListPage />);

    expect(page.addServer.at(-1)?.open).toBe(true);
  });

  it("goes to the new plugin's page once it is added", () => {
    render(<PluginListPage />);

    const onAdded = page.addServer.at(-1)?.onAdded as (plugin: { metadata: { org: string; slug: string } }) => void;
    onAdded({ metadata: { org: "org_acme", slug: "linear" } });

    expect(page.detail).toEqual([{ type: "plugins", org: "org_acme", slug: "linear" }]);
  });
});

describe("web ScheduleListPage", () => {
  it("lists the active org by its id", () => {
    render(<ScheduleListPage />);

    expect(page.workbench.at(-1)?.org).toBe("org_acme");
  });
});
