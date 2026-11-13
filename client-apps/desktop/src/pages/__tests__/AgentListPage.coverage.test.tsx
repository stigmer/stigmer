/**
 * Pins the desktop agents list's Apply YAML, now in the page header: it
 * opens the apply dialog in the active organization, closed until pressed,
 * and an apply reads the list again in place (the workbench's refetch token
 * moves). The workbench and the dialog are pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
  const noop = () => undefined;
  const resourceClient = { list: noop, delete: noop };
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
    OrgSlugText: () => null,
    createLibraryListFn: () => async () => ({ entries: [], nextPageToken: "" }),
    ApplyManifestDialog: (props: DialogProps) => {
      page.dialog.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async () => false,
      handleConfirm: noop,
      handleCancel: noop,
    }),
    useStigmer: () => ({ agent: resourceClient }),
    toast: { success: vi.fn(), error: vi.fn() },
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => ({ allowed: true, isLoading: false }),
    useOrgSlugForId: () => (id: string) => id,
  };
});

import AgentListPage from "../library/AgentListPage";

beforeEach(() => {
  page.dialog.length = 0;
  page.refetchTokens.length = 0;
});

describe("desktop AgentListPage Apply YAML", () => {
  it("opens the apply dialog in the active org, and an apply reads the list again", () => {
    render(
      <MemoryRouter initialEntries={["/library/agents"]}>
        <Routes>
          <Route path="*" element={<AgentListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(page.dialog.at(-1)).toMatchObject({ open: false, org: "org_acme" });
    const before = page.refetchTokens.at(-1);

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.dialog.at(-1)?.open).toBe(true);

    act(() => page.dialog.at(-1)?.onApplied());
    expect(page.refetchTokens.at(-1)).not.toBe(before);
  });
});
