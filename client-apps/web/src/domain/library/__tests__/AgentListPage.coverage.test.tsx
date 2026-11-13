/**
 * Pins the web agents list's Apply YAML, now in the page header: it opens
 * the apply dialog in the active organization, closed until pressed, and an
 * apply reads the list again in place (the workbench's refetch token moves).
 * The workbench and the dialog are pinned in @stigmer/react-sdk.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

interface DialogProps {
  open: boolean;
  org: string;
  onApplied: () => void;
}

const page = vi.hoisted(() => ({
  dialog: [] as DialogProps[],
  refetchTokens: [] as unknown[],
}));

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  const kind = {
    list: async () => ({ entries: [], nextPageToken: "" }),
    delete: async () => undefined,
  };
  return {
    Button: kit.Button,
    IconButton: kit.IconButton,
    LinkButton: kit.LinkButton,
    PageHeader: kit.PageHeader,
    ResourceWorkbench: (props: { refetchToken?: unknown }) => {
      page.refetchTokens.push(props.refetchToken);
      return null;
    },
    ResourceActionBar: () => null,
    ApplyManifestDialog: (props: DialogProps) => {
      page.dialog.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    OrgSlugText: () => null,
    createLibraryListFn: () => kind.list,
    useStigmer: () => ({ agent: kind }),
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => ({ allowed: true, isLoading: false }),
    useOrgSlugForId: () => (id: string) => id,
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async () => false,
      handleConfirm: () => undefined,
      handleCancel: () => undefined,
    }),
    toast: { success: () => undefined, error: () => undefined },
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
}));

import { AgentListPage } from "../agents/AgentListPage";

beforeEach(() => {
  page.dialog.length = 0;
  page.refetchTokens.length = 0;
});

describe("web AgentListPage Apply YAML", () => {
  it("opens the apply dialog in the active org, and an apply reads the list again", () => {
    render(<AgentListPage />);
    expect(page.dialog.at(-1)).toMatchObject({ open: false, org: "org_acme" });
    const before = page.refetchTokens.at(-1);

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.dialog.at(-1)?.open).toBe(true);

    act(() => page.dialog.at(-1)?.onApplied());
    expect(page.refetchTokens.at(-1)).not.toBe(before);
  });
});
