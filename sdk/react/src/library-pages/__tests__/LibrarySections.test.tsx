/**
 * Pins the Library's list sections, the pages both consoles render. Each
 * lists the active organization by its id, the way the server names every
 * org. Agents, skills and plugins show a row's organization through
 * OrgSlugText (its slug, never the raw id), open a row on the row's own
 * organization and slug, and copy the `<org slug>/<slug>`
 * reference a person types elsewhere; each is one list of rows, and a row's
 * Delete (Remove for a plugin) is offered only on the server's yes for that
 * row (CON-01). A row's Delete on the agents list confirms in the agent
 * page's words. A delete runs from its confirm dialog, which says a
 * refusal in place (the dialog's own behaviour is pinned beside it); here
 * the stand-in records the failure the dialog would show. Upload skill is offered only to someone the server lets
 * upload one. New agent is offered only to
 * someone the server lets create one. The plugins list offers the
 * Marketplace, an upload and Add MCP server (open on arrival when the host
 * asks, CON-01 for who may install and remove), and opens a plugin once it
 * is added. Routines and environments open Apply YAML in the active org and
 * read the list again after an apply; environments offer New environment
 * and Apply YAML only to someone the server lets create one. Files offer
 * Upload to whoever may upload and open a row in the File's preview. The
 * workbench, the menus, the dialogs and the checks are pinned beside their
 * own modules and stand in here to capture their props.
 */
import type { ReactNode } from "react";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Props = Record<string, unknown>;

interface ColumnDef {
  id: string;
  cell: (item: unknown) => ReactNode;
}

const SEARCH_ROW = { id: "agt_1", org: "org_shared", slug: "triage", name: "Triage", description: "" };

const page = vi.hoisted(() => ({
  /** The relations every row's resource holds, as the self-check would answer them. */
  granted: ["can_delete"] as string[],
  canCreateAgent: { allowed: true, isLoading: false },
  canCreatePlugin: { allowed: true, isLoading: false },
  canCreateSkill: { allowed: true, isLoading: false },
  canCreateEnvironment: { allowed: true, isLoading: false },
  canCreateFile: { allowed: true, isLoading: false },
  pluginAsked: [] as Array<string | null>,
  /** The row the workbench stand-in draws and opens. */
  row: null as unknown,
  workbench: [] as Props[],
  props: new Map<string, Props>(),
  applyDialog: [] as Props[],
  addServer: [] as Props[],
  confirms: [] as Array<{ title: string; description: string }>,
  confirmAnswer: false,
  // What a confirm dialog said after its act failed: its headline and the error.
  dialogFailures: [] as Array<{ title: string | undefined; message: string }>,
  deleted: [] as string[],
  deleteFailure: undefined as unknown,
  toasts: [] as Array<[string, string]>,
}));

vi.mock("../../resource-workbench/components/ResourceWorkbench.js", () => ({
  // Draws one row the way the workbench does (each column's cell, then the
  // row's action slot), the empty list's act, and a press that opens the row.
  ResourceWorkbench: (props: Props) => {
    page.workbench.push(props);
    const columns = (props.columns as ColumnDef[] | undefined) ?? [];
    const renderItemAction = props.renderItemAction as ((item: unknown) => ReactNode) | undefined;
    const renderRow = props.renderRow as ((item: unknown) => ReactNode) | undefined;
    const onItemClick = props.onItemClick as ((item: unknown) => void) | undefined;
    return (
      <div>
        {columns.map((column) => (
          <div key={column.id} data-testid={`cell-${column.id}`}>
            {column.cell(page.row)}
          </div>
        ))}
        <div data-testid="row">{renderRow?.(page.row)}</div>
        {renderItemAction?.(page.row)}
        <button type="button" onClick={() => onItemClick?.(page.row)}>
          open row
        </button>
      </div>
    );
  },
}));

vi.mock("../../action-menu/ActionMenu.js", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ActionMenu: Object.assign(Passthrough, {
      Trigger: () => null,
      Content: Passthrough,
      Separator: () => null,
      Item: ({ children, onSelect }: { children?: ReactNode; onSelect: () => void }) => (
        <button type="button" onClick={onSelect}>
          {children}
        </button>
      ),
    }),
  };
});

// Stands in for the kit's bar: an act that requires a relation is offered
// only when the row's resource holds it (the rule is pinned beside the bar).
vi.mock("../../resource-detail/ResourceActionBar.js", () => ({
  ResourceActionBar: ({
    resource,
    menuLabel,
    actions,
  }: {
    resource?: { kind: string; id: string } | null;
    menuLabel?: string;
    actions: Array<{ id: string; label: string; requires?: string; onAction: () => void }>;
  }) => (
    <div aria-label={menuLabel} data-resource={resource ? `${resource.kind}:${resource.id}` : ""}>
      {actions
        .filter((action) => action.requires === undefined || page.granted.includes(action.requires))
        .map((action) => (
          <button key={action.id} type="button" onClick={action.onAction}>
            {action.label}
          </button>
        ))}
    </div>
  ),
}));

vi.mock("../../resource-detail/ConfirmDialog.js", () => ({ ConfirmDialog: () => null }));
vi.mock("../../resource-detail/useConfirmAction.js", () => ({
  useConfirmAction: () => ({
    confirmState: null,
    // As the real hook: an act given to the dialog runs on confirm, and a
    // failure stays in the dialog; the stand-in person then cancels.
    confirm: async (options: { title: string; description: string; action?: () => Promise<void>; failureTitle?: string }) => {
      page.confirms.push(options);
      if (!page.confirmAnswer || !options.action) return page.confirmAnswer;
      try {
        await options.action();
        return true;
      } catch (error) {
        page.dialogFailures.push({ title: options.failureTitle, message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    handleConfirm: () => undefined,
    handleCancel: () => undefined,
  }),
}));
vi.mock("../../manifest/ApplyManifestDialog.js", () => ({
  ApplyManifestDialog: (props: Props) => {
    page.applyDialog.push(props);
    return null;
  },
}));
vi.mock("../../plugin/AddMcpServerDialog.js", () => ({
  AddMcpServerDialog: (props: Props) => {
    page.addServer.push(props);
    return null;
  },
}));
vi.mock("../../agent/useCanCreateAgent.js", () => ({ useCanCreateAgent: () => page.canCreateAgent }));
vi.mock("../../plugin/useCanCreatePlugin.js", () => ({
  useCanCreatePlugin: (org: string | null) => {
    page.pluginAsked.push(org);
    return page.canCreatePlugin;
  },
}));
vi.mock("../../skill/useCanCreateSkill.js", () => ({ useCanCreateSkill: () => page.canCreateSkill }));
vi.mock("../../environment/useCanCreateEnvironment.js", () => ({
  useCanCreateEnvironment: () => page.canCreateEnvironment,
}));
vi.mock("../../file/useCanCreateFile.js", () => ({ useCanCreateFile: () => page.canCreateFile }));
vi.mock("../../organization/OrgProvider.js", async () => ({
  ...(await vi.importActual<typeof import("../../organization/OrgProvider.js")>("../../organization/OrgProvider.js")),
  useActiveOrgId: () => "org_acme",
}));
vi.mock("../../organization/useOrgRefs.js", async () => ({
  ...(await vi.importActual<typeof import("../../organization/useOrgRefs.js")>("../../organization/useOrgRefs.js")),
  // The person's organizations: the active one and the one sharing the row.
  useOrgSlugForId: () => (id: string) => ({ org_acme: "acme", org_shared: "shared-team" })[id] ?? id,
}));
// A stand-in that shows which org id the column handed it.
vi.mock("../../organization/OrgSlugText.js", () => ({
  OrgSlugText: ({ orgId }: { orgId: string }) => <span data-org-id={orgId}>slug of {orgId}</span>,
}));
vi.mock("../../feedback/toast.js", () => ({
  toast: {
    success: (message: string) => page.toasts.push(["success", message]),
    error: (message: string) => page.toasts.push(["error", message]),
  },
}));
vi.mock("../../routine/RoutineRowActions.js", () => ({
  RoutineRowActions: (props: Props) => {
    page.props.set("RoutineRowActions", props);
    return null;
  },
}));
vi.mock("../../routine/routineColumns.js", () => ({
  createRoutineColumns: () => [
    { id: "name", cell: () => "daily-report" },
    { id: "state", cell: () => "Active" },
    { id: "cron", cell: () => "Every day at 09:00" },
  ],
}));
vi.mock("../../routine/routineListFn.js", () => ({ createRoutineListFn: () => async () => ({ entries: [] }) }));
vi.mock("../../environment/EnvironmentsNotOnServerNotice.js", () => ({ EnvironmentsNotOnServerNotice: () => null }));
vi.mock("../../environment/environmentColumns.js", () => ({
  createEnvironmentColumns: () => [],
  describePackagesShort: () => "4 packages",
}));
vi.mock("../../environment/environmentListFn.js", () => ({ createEnvironmentListFn: () => async () => ({ entries: [] }) }));
vi.mock("../../file/FileUploadButton.js", () => ({
  FileUploadButton: (props: Props) => {
    page.props.set("FileUploadButton", props);
    return <button type="button">Upload</button>;
  },
}));
vi.mock("../../file/LibraryFilePreview.js", () => ({
  LibraryFilePreview: (props: Props) => {
    page.props.set("LibraryFilePreview", props);
    return <div>preview</div>;
  },
}));
vi.mock("../../file/fileColumns.js", () => ({ createFileColumns: () => [] }));
vi.mock("../../file/fileListFn.js", () => ({ createFileListFn: () => async () => ({ entries: [] }) }));
vi.mock("@stigmer/react-core", async () => {
  const kind = {
    list: async () => ({ entries: [], nextPageToken: "" }),
    delete: async (id: string) => {
      if (page.deleteFailure !== undefined) throw page.deleteFailure;
      page.deleted.push(id);
    },
  };
  return {
    ...(await vi.importActual<typeof import("@stigmer/react-core")>("@stigmer/react-core")),
    useStigmer: () => ({ agent: kind, skill: kind, plugin: kind }),
    createLibraryListFn: () => kind.list,
  };
});

import { LibraryAgentsSection } from "../LibraryAgentsSection";
import { LibrarySkillsSection } from "../LibrarySkillsSection";
import { LibraryPluginsSection } from "../LibraryPluginsSection";
import { LibraryRoutinesSection } from "../LibraryRoutinesSection";
import { LibraryEnvironmentsSection } from "../LibraryEnvironmentsSection";
import { LibraryFilesSection } from "../LibraryFilesSection";
import { AGENT_DELETE_DESCRIPTION } from "../agentDeleteDescription";
import type { LibraryResourceRef } from "../navigation";

let opened: LibraryResourceRef[] = [];
let copied: string[] = [];
const onOpen = (resource: LibraryResourceRef) => {
  opened.push(resource);
};

beforeEach(() => {
  page.granted = ["can_delete"];
  page.canCreateAgent = { allowed: true, isLoading: false };
  page.canCreatePlugin = { allowed: true, isLoading: false };
  page.canCreateSkill = { allowed: true, isLoading: false };
  page.canCreateEnvironment = { allowed: true, isLoading: false };
  page.canCreateFile = { allowed: true, isLoading: false };
  page.pluginAsked.length = 0;
  page.row = SEARCH_ROW;
  page.workbench.length = 0;
  page.props.clear();
  page.applyDialog.length = 0;
  page.addServer.length = 0;
  page.confirms.length = 0;
  page.confirmAnswer = false;
  page.dialogFailures.length = 0;
  page.deleted.length = 0;
  page.deleteFailure = undefined;
  page.toasts.length = 0;
  opened = [];
  copied = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text: string) => {
    copied.push(text);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function workbench(): Props {
  const props = page.workbench.at(-1);
  if (!props) throw new Error("the workbench was not rendered");
  return props;
}

describe.each([
  { name: "LibraryAgentsSection", Section: LibraryAgentsSection, kind: "agents", noun: "agent" },
  { name: "LibrarySkillsSection", Section: LibrarySkillsSection, kind: "skills", noun: "skill" },
  { name: "LibraryPluginsSection", Section: LibraryPluginsSection, kind: "plugins", noun: "plugin" },
] as const)("$name: organizations", ({ Section, kind, noun }) => {
  it("lists the active org by its id", () => {
    render(<Section onOpen={onOpen} />);

    expect(workbench().org).toBe("org_acme");
  });

  it("shows a row's org through OrgSlugText, from the id the row names it by", () => {
    render(<Section onOpen={onOpen} />);

    expect(screen.getByTestId("cell-org").textContent).toBe("slug of org_shared");
  });

  it("opens a row on the row's own organization and slug", () => {
    render(<Section onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "open row" }));

    expect(opened).toEqual([{ kind, org: "org_shared", slug: "triage" }]);
  });

  it("CON-01 offers the row's Delete only on the server's yes for that row, and Copy ID always", () => {
    page.granted = [];
    render(<Section onOpen={onOpen} />);

    expect(screen.getByRole("button", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: kind === "plugins" ? "Remove" : "Delete" })).toBeNull();
    expect(screen.getByLabelText("Actions for Triage").getAttribute("data-resource")).toBe(`${noun}:agt_1`);
  });

  it("draws one list of rows, with no cards or table switch", () => {
    render(<Section onOpen={onOpen} />);

    expect(workbench().viewModes).toEqual(["list"]);
    expect(workbench().defaultViewMode).toBe("list");
    expect(workbench().itemsLabel).toBe(kind);
  });

  it("copies the row's reference under its org's slug, and says so", () => {
    render(<Section onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));

    expect(copied).toEqual(["shared-team/triage"]);
    expect(page.toasts).toEqual([["success", `Copied ${noun} ID`]]);
  });
});

describe("LibraryAgentsSection delete", () => {
  it("confirms in the agent page's words, naming the agent alone", () => {
    render(<LibraryAgentsSection onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(page.confirms).toHaveLength(1);
    expect(page.confirms[0]!.title).toBe("Delete Triage?");
    expect(page.confirms[0]!.description).toBe(AGENT_DELETE_DESCRIPTION);
    expect(page.confirms[0]!.description).not.toMatch(/instance/);
  });
});

describe("LibraryAgentsSection delete, once asked", () => {
  it("deletes the agent once the person confirms, says so, and reads the list again", async () => {
    page.confirmAnswer = true;
    render(<LibraryAgentsSection onOpen={onOpen} />);
    const before = workbench().refetchToken;

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(page.toasts).toEqual([["success", "Triage deleted"]]));
    expect(page.deleted).toEqual(["agt_1"]);
    expect(workbench().refetchToken).not.toBe(before);
  });

  it("says in the confirm dialog that the delete failed when the server refuses it, and keeps the list", async () => {
    page.confirmAnswer = true;
    page.deleteFailure = new Error("refused");
    render(<LibraryAgentsSection onOpen={onOpen} />);
    const before = workbench().refetchToken;

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(page.dialogFailures).toEqual([{ title: "Couldn't delete Triage.", message: "refused" }]));
    expect(page.toasts).toEqual([]);
    expect(workbench().refetchToken).toBe(before);
  });
});

describe("LibraryAgentsSection Apply YAML", () => {
  it("opens the apply dialog in the active org, and an apply reads the list again", () => {
    render(<LibraryAgentsSection onOpen={onOpen} />);
    expect(page.applyDialog.at(-1)).toMatchObject({ open: false, org: "org_acme" });
    const before = workbench().refetchToken;

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.applyDialog.at(-1)?.open).toBe(true);

    act(() => (page.applyDialog.at(-1)?.onApplied as () => void)());
    expect(workbench().refetchToken).not.toBe(before);
  });
});

describe("LibraryAgentsSection: who may create agents", () => {
  function renderEmptyAction() {
    return render(<>{workbench().emptyAction as ReactNode}</>);
  }

  it("offers New agent in the header and the empty list to someone the server lets create one", () => {
    render(<LibraryAgentsSection onOpen={onOpen} />);
    renderEmptyAction();

    const links = screen.getAllByRole("link", { name: "New agent" });
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/library/agents/new");
  });

  it("offers no New agent to someone the server would refuse, and keeps Apply YAML", () => {
    page.canCreateAgent = { allowed: false, isLoading: false };
    render(<LibraryAgentsSection onOpen={onOpen} />);

    expect(screen.queryByRole("link", { name: "New agent" })).toBeNull();
    expect(workbench().emptyAction).toBeUndefined();
    expect(screen.getByRole("button", { name: "Apply YAML" })).toBeTruthy();
  });

  it("draws its links with the host's link component", () => {
    render(
      <LibraryAgentsSection
        onOpen={onOpen}
        renderLink={({ href, children }) => (
          <a href={href} data-host-link="">
            {children}
          </a>
        )}
      />,
    );

    expect(screen.getByRole("link", { name: "New agent" }).hasAttribute("data-host-link")).toBe(true);
  });
});

describe("LibrarySkillsSection", () => {
  it("opens the apply dialog in the active org from Apply YAML, and an apply reads the list again", () => {
    render(<LibrarySkillsSection onOpen={onOpen} />);
    const before = workbench().refetchToken;

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.applyDialog.at(-1)).toMatchObject({ open: true, org: "org_acme" });

    act(() => (page.applyDialog.at(-1)?.onApplied as () => void)());
    expect(workbench().refetchToken).not.toBe(before);
  });

  it("offers Upload skill in the header and the empty list", () => {
    render(<LibrarySkillsSection onOpen={onOpen} />);
    render(<>{workbench().emptyAction as ReactNode}</>);

    const links = screen.getAllByRole("link", { name: "Upload skill" });
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/library/skills/new");
  });

  it("says who uploads only once the server has answered", () => {
    page.canCreateSkill = { allowed: false, isLoading: true };
    render(<LibrarySkillsSection onOpen={onOpen} />);

    expect(workbench().emptyDescription).toBe("Upload a skill package to give your agents reusable instructions and context.");
    expect(workbench().emptyAction).toBeUndefined();
  });

  it("CON-01 offers a member no Upload skill, and says who uploads", () => {
    page.canCreateSkill = { allowed: false, isLoading: false };
    render(<LibrarySkillsSection onOpen={onOpen} />);

    expect(screen.queryByRole("link", { name: "Upload skill" })).toBeNull();
    expect(workbench().emptyAction).toBeUndefined();
    expect(workbench().emptyDescription).toBe("Admins of acme upload skills. Once one does, every agent here can use it.");
    expect(screen.getByRole("button", { name: "Apply YAML" })).toBeTruthy();
  });

  it("deletes a skill only once the person confirms, then reads the list again", async () => {
    page.confirmAnswer = true;
    render(<LibrarySkillsSection onOpen={onOpen} />);
    const before = workbench().refetchToken;

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(page.toasts).toEqual([["success", "Triage deleted"]]));
    expect(page.deleted).toEqual(["agt_1"]);
    expect(workbench().refetchToken).not.toBe(before);
  });

  it("deletes nothing when the person declines", async () => {
    render(<LibrarySkillsSection onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(page.confirms).toHaveLength(1));
    expect(page.deleted).toEqual([]);
    expect(page.toasts).toEqual([]);
  });

  it("says in the confirm dialog that the delete failed when the server refuses it", async () => {
    page.confirmAnswer = true;
    page.deleteFailure = new Error("refused");
    render(<LibrarySkillsSection onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(page.dialogFailures).toEqual([{ title: "Couldn't delete Triage.", message: "refused" }]));
    expect(page.toasts).toEqual([]);
  });
});

describe("LibraryPluginsSection ways in", () => {
  it("offers the Marketplace, an upload, and Add MCP server, which opens the form until it is dismissed", () => {
    render(<LibraryPluginsSection onOpen={onOpen} />);
    const header = within(screen.getByRole("banner"));

    expect(header.getByRole("link", { name: "Browse Marketplace" }).getAttribute("href")).toBe("/marketplace");
    expect(header.getByRole("link", { name: "Upload plugin" }).getAttribute("href")).toBe("/library/plugins/upload");
    expect(page.addServer.at(-1)).toMatchObject({ org: "org_acme", open: false });

    fireEvent.click(header.getByRole("button", { name: "Add MCP server" }));
    expect(page.addServer.at(-1)?.open).toBe(true);

    act(() => (page.addServer.at(-1)?.onClose as () => void)());
    expect(page.addServer.at(-1)?.open).toBe(false);
  });

  it("opens the add form on arrival when the host asks", () => {
    render(<LibraryPluginsSection onOpen={onOpen} addMcpServerOnArrival />);

    expect(page.addServer.at(-1)?.open).toBe(true);
  });

  it("opens the new plugin once it is added", () => {
    render(<LibraryPluginsSection onOpen={onOpen} />);

    act(() => (page.addServer.at(-1)?.onAdded as (plugin: unknown) => void)({ metadata: { org: "org_shared", slug: "linear" } }));

    expect(opened).toEqual([{ kind: "plugins", org: "org_shared", slug: "linear" }]);
    expect(page.addServer.at(-1)?.open).toBe(false);
  });
});

describe("LibraryPluginsSection: who may install", () => {
  it("CON-01 offers an admin the upload and the add form, asked of the active organization", () => {
    render(<LibraryPluginsSection onOpen={onOpen} />);

    expect(page.pluginAsked.at(-1)).toBe("org_acme");
    expect(screen.getAllByRole("link", { name: "Upload plugin" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Add MCP server" }).length).toBeGreaterThan(0);
    expect(workbench().emptyDescription).toMatch(/^Install a plugin/);
  });

  it("CON-01 offers a member the Marketplace alone, says who installs, and never mounts the add form", () => {
    page.canCreatePlugin = { allowed: false, isLoading: false };
    render(<LibraryPluginsSection onOpen={onOpen} />);

    expect(screen.getAllByRole("link", { name: "Browse Marketplace" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Upload plugin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add MCP server" })).toBeNull();
    expect(workbench().emptyDescription).toBe("Admins of acme install plugins. Browse the Marketplace to see what's offered.");
    expect(page.addServer).toHaveLength(0);
  });
});

describe("LibraryPluginsSection: who may remove a row's plugin", () => {
  it("CON-01 offers an owner the row's Remove, declared on that row's plugin", () => {
    render(<LibraryPluginsSection onOpen={onOpen} />);

    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getByLabelText("Actions for Triage").getAttribute("data-resource")).toBe("plugin:agt_1");
  });

  it("CON-01 offers a member the row's Copy ID, and no Remove", () => {
    page.granted = [];
    render(<LibraryPluginsSection onOpen={onOpen} />);

    expect(screen.getByRole("button", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

describe("LibraryPluginsSection Remove", () => {
  function remove(): void {
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  }

  it("asks first, then deletes the plugin by its id, says so, and refetches the list", async () => {
    page.confirmAnswer = true;
    render(<LibraryPluginsSection onOpen={onOpen} />);
    const before = workbench().refetchToken as number;

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["success", "Triage removed"]]));
    expect(page.confirms[0]).toMatchObject({ title: "Remove Triage?" });
    expect(page.confirms[0]!.description).toMatch(/^Removes the plugin and its versions\./);
    expect(page.deleted).toEqual(["agt_1"]);
    expect(workbench().refetchToken).toBe(before + 1);
  });

  it("removes nothing when the person declines", async () => {
    render(<LibraryPluginsSection onOpen={onOpen} />);

    remove();

    await waitFor(() => expect(page.confirms).toHaveLength(1));
    expect(page.deleted).toEqual([]);
    expect(page.toasts).toEqual([]);
  });

  it("says the server's refusal in the confirm dialog, as the server words it", async () => {
    page.confirmAnswer = true;
    page.deleteFailure = new Error("plugin is used by agent acme/helper");
    render(<LibraryPluginsSection onOpen={onOpen} />);

    remove();

    await waitFor(() =>
      expect(page.dialogFailures).toEqual([{ title: "Couldn't remove Triage.", message: "plugin is used by agent acme/helper" }]),
    );
    expect(page.toasts).toEqual([]);
    expect(page.deleted).toEqual([]);
  });
});

describe("LibraryRoutinesSection", () => {
  it("lists the active org by its id, with no search", () => {
    render(<LibraryRoutinesSection onOpen={onOpen} />);

    expect(workbench().org).toBe("org_acme");
    expect(workbench().searchable).toBe(false);
  });

  it("opens the Apply YAML dialog in the active org from the header, and an apply reads the list again", () => {
    render(<LibraryRoutinesSection onOpen={onOpen} />);
    expect(page.applyDialog.at(-1)).toMatchObject({ open: false, org: "org_acme" });
    const before = workbench().refetchToken;

    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Apply YAML" }));
    expect(page.applyDialog.at(-1)?.open).toBe(true);

    act(() => (page.applyDialog.at(-1)?.onApplied as () => void)());
    expect(workbench().refetchToken).not.toBe(before);
  });

  it("opens a row's routine, keyed by its id", () => {
    page.row = { metadata: { id: "rtn_1", org: "org_shared", slug: "nightly" } };
    render(<LibraryRoutinesSection onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "open row" }));

    expect(opened).toEqual([{ kind: "routines", org: "org_shared", slug: "nightly" }]);
    expect((workbench().getItemId as (item: unknown) => string)(page.row)).toBe("rtn_1");
    expect(screen.getAllByRole("link", { name: "New routine" })[0]!.getAttribute("href")).toBe("/library/routines/new");
  });
});

describe("LibraryRoutinesSection row actions", () => {
  it("hands a row's actions its routine, and reads the list again after one", () => {
    page.row = { metadata: { id: "rtn_1", org: "org_shared", slug: "nightly" } };
    render(<LibraryRoutinesSection onOpen={onOpen} />);
    const actions = page.props.get("RoutineRowActions")!;
    expect(actions.routine).toBe(page.row);
    const before = workbench().refetchToken;

    act(() => (actions.onChanged as () => void)());

    expect(workbench().refetchToken).not.toBe(before);
  });
});

describe("LibraryEnvironmentsSection", () => {
  beforeEach(() => {
    page.row = { metadata: { id: "env_1", org: "org_shared", slug: "python" } };
  });

  it("lists the active org by its id and opens a row as its Environment", () => {
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);

    expect(workbench().org).toBe("org_acme");
    fireEvent.click(screen.getByRole("button", { name: "open row" }));
    expect(opened).toEqual([{ kind: "environments", org: "org_shared", slug: "python" }]);
  });

  it("offers New environment and Apply YAML to someone the server lets create one", () => {
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);
    render(<>{workbench().emptyAction as ReactNode}</>);

    expect(screen.getAllByRole("link", { name: "New environment" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Apply YAML" })).toBeTruthy();
  });

  it("offers neither to someone the server would refuse", () => {
    page.canCreateEnvironment = { allowed: false, isLoading: false };
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);

    expect(screen.queryByRole("link", { name: "New environment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply YAML" })).toBeNull();
    expect(workbench().emptyAction).toBeUndefined();
  });

  it("opens Apply YAML and refreshes the list once a manifest is applied", () => {
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);
    const before = workbench().refetchToken;

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.applyDialog.at(-1)).toMatchObject({ open: true, org: "org_acme" });

    act(() => (page.applyDialog.at(-1)?.onApplied as () => void)());
    expect(workbench().refetchToken).not.toBe(before);
  });

  it("keys each row by its Environment's id", () => {
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);

    expect((workbench().getItemId as (item: unknown) => string)(page.row)).toBe("env_1");
  });
});

describe("LibraryFilesSection", () => {
  it("lists the active organization's Files with no search, and offers Upload to whoever may upload", () => {
    render(<LibraryFilesSection onOpen={onOpen} />);

    expect(workbench().org).toBe("org_acme");
    expect(workbench().searchable).toBe(false);
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(page.props.get("FileUploadButton")?.org).toBe("org_acme");
  });

  it("offers no Upload to someone the server would refuse, or before it answers", () => {
    page.canCreateFile = { allowed: false, isLoading: true };
    render(<LibraryFilesSection onOpen={onOpen} />);

    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it("refreshes the list after an upload", () => {
    render(<LibraryFilesSection onOpen={onOpen} />);
    const before = workbench().refetchToken;

    act(() => (page.props.get("FileUploadButton")!.onUploaded as () => void)());

    expect(workbench().refetchToken).not.toBe(before);
  });

  it("opens a row in the File's preview, refreshes after a change, and opens an added skill", () => {
    const file = { metadata: { id: "file_1", org: "org_acme" }, spec: { filename: "tools.zip" } };
    page.row = file;
    render(<LibraryFilesSection onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "open row" }));
    const preview = page.props.get("LibraryFilePreview")!;
    expect(preview.file).toBe(file);

    const before = workbench().refetchToken;
    act(() => (preview.onChanged as () => void)());
    expect(workbench().refetchToken).not.toBe(before);

    act(() => (preview.onApplied as (r: unknown) => void)({ kind: "Skill", name: "tools", org: "org_acme", slug: "tools" }));
    expect(opened).toEqual([{ kind: "skills", org: "org_acme", slug: "tools" }]);

    // Rows are keyed by the File's id, and closing the preview drops it.
    expect((workbench().getItemId as (f: unknown) => string)(file)).toBe("file_1");
    expect(screen.getByText("preview")).toBeTruthy();
    act(() => (preview.onClose as () => void)());
    expect(screen.queryByText("preview")).toBeNull();
  });
});

describe("the rows the sections draw", () => {
  it("draws an agent as its name, a Private tag, its one line, and when it last changed", () => {
    page.row = {
      ...SEARCH_ROW,
      description: "Labels each new ticket.",
      visibility: ApiResourceVisibility.visibility_private,
      updatedAt: timestampFromDate(new Date(Date.now() - 2 * 3_600_000)),
    };
    render(<LibraryAgentsSection onOpen={onOpen} />);

    expect(screen.getByTestId("row").textContent).toBe("TriagePrivateLabels each new ticket.2h");
  });

  it("says no time for an agent that carries none, and no tag for one the organization sees", () => {
    render(<LibraryAgentsSection onOpen={onOpen} />);

    expect(screen.getByTestId("row").textContent).toBe("Triage");
  });

  it("draws an Environment with the form's words for its network, and its packages when it has no description", () => {
    page.row = {
      metadata: { id: "env_1", org: "org_shared", slug: "python", name: "python" },
      spec: { networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] } },
    };
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);

    expect(screen.getByTestId("row").textContent).toBe("pythonListed websites4 packages");
    fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));
    expect(copied).toEqual(["shared-team/python"]);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("draws an Environment that may reach any website, with its own description", () => {
    page.row = { metadata: { id: "env_2", org: "org_acme", slug: "open" }, spec: { description: "Anything goes" } };
    render(<LibraryEnvironmentsSection onOpen={onOpen} />);

    expect(screen.getByTestId("row").textContent).toBe("openAny websiteAnything goes");
  });

  it("reads a routine as a row when narrow: its name, its state beside it, when it runs under it", () => {
    page.row = { metadata: { id: "rtn_1", org: "org_shared", slug: "nightly" } };
    render(<LibraryRoutinesSection onOpen={onOpen} />);

    expect(workbench().narrowViewMode).toBe("list");
    expect(workbench().itemsLabel).toBe("routines");
    expect(screen.getByTestId("row").textContent).toBe("daily-reportActiveEvery day at 09:00");
  });

  it("reads a File as a row when narrow", () => {
    page.row = { metadata: { id: "file_1", org: "org_acme" }, spec: { filename: "ledger.csv" } };
    render(<LibraryFilesSection onOpen={onOpen} />);

    expect(workbench().narrowViewMode).toBe("list");
    expect(workbench().itemsLabel).toBe("files");
  });
});
