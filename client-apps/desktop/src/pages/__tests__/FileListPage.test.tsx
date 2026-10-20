/**
 * Pins the desktop Files page's seams around the SDK, as the web page's
 * test does: the list reads the active organization's Library Files with
 * no search, keyed by id; Upload shows only to someone the server lets
 * upload and refreshes the list after one; a row opens the File's preview,
 * which closes, refreshes the list after a change, and opens an added
 * skill at its Library address under the organization's slug. The
 * workbench, upload button and preview are pinned in @stigmer/react-sdk
 * and stubbed here to capture their props.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({
  canCreate: { allowed: true, isLoading: false },
  props: new Map<string, Props>(),
}));

vi.mock("@stigmer/react-sdk", () => ({
  ResourceWorkbench: (props: Props) => {
    page.props.set("ResourceWorkbench", props);
    return <div>{props.headerAction as ReactNode}</div>;
  },
  FileUploadButton: (props: Props) => {
    page.props.set("FileUploadButton", props);
    return <button type="button">Upload</button>;
  },
  LibraryFilePreview: (props: Props) => {
    page.props.set("LibraryFilePreview", props);
    return <p>preview</p>;
  },
  createFileColumns: () => [],
  createFileListFn: () => async () => ({ entries: [], nextPageToken: "" }),
  useStigmer: () => ({}),
  useActiveOrgId: () => "org_acme",
  useCanCreateFile: () => page.canCreate,
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
}));

import FileListPage from "../library/FileListPage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/library/files"]}>
      <Routes>
        <Route path="*" element={<FileListPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.props.clear();
});

afterEach(cleanup);

describe("desktop Files page", () => {
  it("lists the active organization's Files by id with no search, and refreshes after an upload", () => {
    renderPage();
    const workbench = page.props.get("ResourceWorkbench")!;
    expect(workbench.org).toBe("org_acme");
    expect(workbench.searchable).toBe(false);
    expect((workbench.getItemId as (f: unknown) => string)({ metadata: { id: "file_1" } })).toBe("file_1");

    const before = workbench.refetchToken;
    act(() => (page.props.get("FileUploadButton")!.onUploaded as () => void)());
    expect(page.props.get("ResourceWorkbench")!.refetchToken).not.toBe(before);
  });

  it("offers no Upload before the server says the person may upload", () => {
    page.canCreate = { allowed: false, isLoading: true };
    renderPage();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it("opens a row's preview, refreshes after a change, opens an added skill, and closes", () => {
    renderPage();
    const file = { metadata: { id: "file_1", org: "org_acme" }, spec: { filename: "tools.zip" } };
    act(() => (page.props.get("ResourceWorkbench")!.onItemClick as (f: unknown) => void)(file));
    expect(screen.getByText("preview")).toBeTruthy();

    const preview = page.props.get("LibraryFilePreview")!;
    const before = page.props.get("ResourceWorkbench")!.refetchToken;
    act(() => (preview.onChanged as () => void)());
    expect(page.props.get("ResourceWorkbench")!.refetchToken).not.toBe(before);

    act(() => (preview.onApplied as (r: unknown) => void)({ kind: "Skill", name: "tools", org: "org_acme", slug: "tools" }));
    expect(screen.getByTestId("location").textContent).toBe("/library/skills/acme/tools");
  });

  it("drops the preview when it closes", () => {
    renderPage();
    act(() =>
      (page.props.get("ResourceWorkbench")!.onItemClick as (f: unknown) => void)({ metadata: { id: "file_1" } }),
    );
    act(() => (page.props.get("LibraryFilePreview")!.onClose as () => void)());
    expect(screen.queryByText("preview")).toBeNull();
  });
});
