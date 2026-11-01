/**
 * Pins the desktop plugins list's ways in and its Remove, as the web list's
 * test pins them there. The header offers the Marketplace, an upload, and
 * "Add MCP server", which opens the add form and closes it again when the
 * form is dismissed. A row's Remove asks first, in the words the detail
 * page uses; once confirmed it deletes the plugin by its id, says so, and
 * refetches the list in place; a refusal is shown as the server words it,
 * and a refusal with no message as a plain failure. Declining removes
 * nothing. Installing is an admin's act (CON-01): the server's
 * `can_create_plugin` answer, asked of the active organization, decides
 * whether the upload and the add form are offered; a member is offered the
 * Marketplace to browse and told who installs. A row's Remove declares
 * `can_delete` on that row's plugin, so the kit's action bar offers it only
 * on the server's yes for that plugin (its rule, in flight included, is
 * pinned in the kit): a member sees no Remove, an owner does. Organization links are
 * pinned in library-list-pages.orgs.test.tsx; the workbench, the form, the
 * confirmation and the check in @stigmer/react-sdk.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

interface Row {
  id: string;
  org: string;
  slug: string;
  name: string;
}

interface WorkbenchProps {
  refetchToken: number;
  renderItemAction?: (item: Row) => ReactNode;
  headerAction?: ReactNode;
  emptyDescription?: string;
}

interface AddServerProps {
  open: boolean;
  onClose: () => void;
}

const ROW: Row = { id: "plg_1", org: "org_acme", slug: "linear", name: "Linear" };

const page = vi.hoisted(() => ({
  /** The relations every row's resource holds, as the self-check would answer them. */
  granted: ["can_delete"] as string[],
  workbench: [] as WorkbenchProps[],
  addServer: [] as AddServerProps[],
  confirms: [] as Array<{ title: string; description: string }>,
  confirmAnswer: true,
  deleted: [] as string[],
  deleteFailure: undefined as unknown,
  toasts: [] as Array<[string, string]>,
  mayInstall: true,
  installAsked: [] as Array<string | null>,
}));

vi.mock("@stigmer/react-sdk", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const ActionMenu = Object.assign(Passthrough, {
    Trigger: () => null,
    Content: Passthrough,
    Separator: () => null,
    Item: ({ children, onSelect }: { children?: ReactNode; onSelect: () => void }) => (
      <button type="button" onClick={onSelect}>
        {children}
      </button>
    ),
  });
  return {
    ResourceWorkbench: (props: WorkbenchProps) => {
      page.workbench.push(props);
      return (
        <div>
          {props.headerAction}
          {props.renderItemAction?.(ROW)}
        </div>
      );
    },
    ActionMenu,
    // Stands in for the kit's bar: an act that requires a relation is offered
    // only when the row's resource holds it (the rule is pinned in the kit).
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
    ConfirmDialog: () => null,
    AddMcpServerDialog: (props: AddServerProps) => {
      page.addServer.push(props);
      return null;
    },
    OrgSlugText: () => null,
    createLibraryListFn: () => async () => ({ entries: [], nextPageToken: "" }),
    useStigmer: () => ({
      plugin: {
        list: async () => ({ entries: [], nextPageToken: "" }),
        delete: async (id: string) => {
          if (page.deleteFailure !== undefined) throw page.deleteFailure;
          page.deleted.push(id);
        },
      },
    }),
    useActiveOrgId: () => "org_acme",
    useCanCreatePlugin: (org: string | null) => {
      page.installAsked.push(org);
      return { allowed: page.mayInstall, isLoading: false };
    },
    useOrgSlugForId: () => (id: string) => id,
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (options: { title: string; description: string }) => {
        page.confirms.push(options);
        return page.confirmAnswer;
      },
      handleConfirm: () => undefined,
      handleCancel: () => undefined,
    }),
    toast: {
      success: (message: string) => page.toasts.push(["success", message]),
      error: (message: string) => page.toasts.push(["error", message]),
    },
  };
});

import PluginListPage from "../library/PluginListPage";

beforeEach(() => {
  page.workbench.length = 0;
  page.addServer.length = 0;
  page.confirms.length = 0;
  page.confirmAnswer = true;
  page.deleted.length = 0;
  page.deleteFailure = undefined;
  page.toasts.length = 0;
  page.mayInstall = true;
  page.installAsked.length = 0;
  page.granted = ["can_delete"];
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/library/plugins"]}>
      <PluginListPage />
    </MemoryRouter>,
  );
}

function remove(): void {
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
}

describe("desktop PluginListPage ways in", () => {
  it("offers the Marketplace, an upload, and Add MCP server, which opens the form until it is dismissed", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Browse Marketplace" }).getAttribute("href")).toBe("/marketplace");
    expect(screen.getByRole("link", { name: "Upload plugin" }).getAttribute("href")).toBe("/library/plugins/upload");
    expect(page.addServer.at(-1)?.open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    expect(page.addServer.at(-1)?.open).toBe(true);

    act(() => page.addServer.at(-1)?.onClose());
    expect(page.addServer.at(-1)?.open).toBe(false);
  });
});

describe("desktop PluginListPage: who may install", () => {
  it("CON-01 offers an admin the upload and the add form, asked of the active organization", () => {
    renderPage();

    expect(page.installAsked.at(-1)).toBe("org_acme");
    expect(screen.getByRole("link", { name: "Upload plugin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add MCP server" })).toBeTruthy();
    expect(page.workbench.at(-1)?.emptyDescription).toMatch(/^Install a plugin/);
  });

  it("CON-01 offers a member the Marketplace alone, says who installs, and never mounts the add form", () => {
    page.mayInstall = false;
    renderPage();

    expect(screen.getByRole("link", { name: "Browse Marketplace" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Upload plugin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add MCP server" })).toBeNull();
    expect(page.workbench.at(-1)?.emptyDescription).toMatch(/^An admin of this organization installs plugins/);
    expect(page.addServer).toHaveLength(0);
  });
});

describe("desktop PluginListPage: who may remove a row's plugin", () => {
  it("CON-01 offers an owner the row's Remove, declared on that row's plugin", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    const row = screen.getByLabelText("Actions for Linear");
    expect(row.getAttribute("data-resource")).toBe("plugin:plg_1");
  });

  it("CON-01 offers a member the row's View details and Copy ID, and no Remove", () => {
    page.granted = [];
    renderPage();

    expect(screen.getByRole("button", { name: "View details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

describe("desktop PluginListPage Remove", () => {
  it("asks first, then deletes the plugin by its id, says so, and refetches the list", async () => {
    renderPage();
    const tokenBefore = page.workbench.at(-1)?.refetchToken;

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["success", "Linear removed"]]));
    expect(page.confirms[0]).toMatchObject({ title: "Remove Linear?" });
    expect(page.confirms[0]!.description).toMatch(/^Removes the plugin and its versions\./);
    expect(page.deleted).toEqual(["plg_1"]);
    expect(page.workbench.at(-1)?.refetchToken).toBe((tokenBefore ?? 0) + 1);
  });

  it("removes nothing when the person declines", async () => {
    page.confirmAnswer = false;
    renderPage();

    remove();

    await waitFor(() => expect(page.confirms).toHaveLength(1));
    expect(page.deleted).toEqual([]);
    expect(page.toasts).toEqual([]);
  });

  it("shows the server's refusal as it words it", async () => {
    page.deleteFailure = new Error("plugin is used by agent acme/helper");
    renderPage();

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["error", "plugin is used by agent acme/helper"]]));
  });

  it("shows a refusal with no message as a plain failure", async () => {
    page.deleteFailure = "refused";
    renderPage();

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["error", "Failed to remove plugin"]]));
  });
});
