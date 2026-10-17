/**
 * Pins the web plugins list's ways in and its Remove. The header offers the
 * Marketplace, an upload, and "Add MCP server", which opens the add form
 * and closes it again when the form is dismissed. A row's Remove asks
 * first, in the words the detail page uses; once confirmed it deletes the
 * plugin by its id, says so, and refetches the list in place; a refusal is
 * shown as the server words it, and a refusal with no message as a plain
 * failure. Declining removes nothing. The workbench, the form and the
 * confirmation are pinned in @stigmer/react-sdk.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
}

interface AddServerProps {
  open: boolean;
  onClose: () => void;
}

const ROW: Row = { id: "plg_1", org: "org_acme", slug: "linear", name: "" };

const page = vi.hoisted(() => ({
  workbench: [] as WorkbenchProps[],
  addServer: [] as AddServerProps[],
  confirms: [] as Array<{ title: string; description: string }>,
  confirmAnswer: true,
  deleted: [] as string[],
  deleteFailure: undefined as unknown,
  toasts: [] as Array<[string, string]>,
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

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
}));

import { PluginListPage } from "../PluginListPage";

beforeEach(() => {
  page.workbench.length = 0;
  page.addServer.length = 0;
  page.confirms.length = 0;
  page.confirmAnswer = true;
  page.deleted.length = 0;
  page.deleteFailure = undefined;
  page.toasts.length = 0;
});

function remove(): void {
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
}

describe("web PluginListPage ways in", () => {
  it("offers the Marketplace, an upload, and Add MCP server, which opens the form until it is dismissed", () => {
    render(<PluginListPage />);

    expect(screen.getByRole("link", { name: "Browse Marketplace" }).getAttribute("href")).toBe("/marketplace");
    expect(screen.getByRole("link", { name: "Upload plugin" }).getAttribute("href")).toBe("/library/plugins/upload");
    expect(page.addServer.at(-1)?.open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    expect(page.addServer.at(-1)?.open).toBe(true);

    act(() => page.addServer.at(-1)?.onClose());
    expect(page.addServer.at(-1)?.open).toBe(false);
  });
});

describe("web PluginListPage Remove", () => {
  it("asks first, then deletes the plugin by its id, says so, and refetches the list", async () => {
    render(<PluginListPage />);
    const tokenBefore = page.workbench.at(-1)?.refetchToken;

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["success", "linear removed"]]));
    expect(page.confirms[0]).toMatchObject({ title: "Remove linear?" });
    expect(page.confirms[0]!.description).toMatch(/^Removes the plugin and its versions\./);
    expect(page.deleted).toEqual(["plg_1"]);
    expect(page.workbench.at(-1)?.refetchToken).toBe((tokenBefore ?? 0) + 1);
  });

  it("removes nothing when the person declines", async () => {
    page.confirmAnswer = false;
    render(<PluginListPage />);

    remove();

    await waitFor(() => expect(page.confirms).toHaveLength(1));
    expect(page.deleted).toEqual([]);
    expect(page.toasts).toEqual([]);
  });

  it("shows the server's refusal as it words it", async () => {
    page.deleteFailure = new Error("plugin is used by agent acme/helper");
    render(<PluginListPage />);

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["error", "plugin is used by agent acme/helper"]]));
  });

  it("shows a refusal with no message as a plain failure", async () => {
    page.deleteFailure = "refused";
    render(<PluginListPage />);

    remove();

    await waitFor(() => expect(page.toasts).toEqual([["error", "Failed to remove plugin"]]));
  });
});
