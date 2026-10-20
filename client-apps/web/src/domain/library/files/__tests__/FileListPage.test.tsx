/**
 * Pins the web Files page's seams around the SDK: the list reads the active
 * organization's Library Files, offers Upload only to someone the server
 * lets upload (and refreshes the list after one), opens a row in the
 * File's preview rather than a page of its own, refreshes the list after
 * a change there, and opens a skill added from a zip as a Library detail.
 * /library/files serves the page. The workbench, the upload button and the
 * preview are pinned in @stigmer/react-sdk and stubbed here to capture
 * their props.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({
  // The server's answer to "may this person upload a file here?".
  canCreate: { allowed: true, isLoading: false },
  props: new Map<string, Props>(),
  detail: [] as Array<[string, string, string]>,
}));

vi.mock("@stigmer/react-sdk", () => {
  const capture = (name: string) => (props: Props) => {
    page.props.set(name, props);
    return null;
  };
  return {
    ResourceWorkbench: (props: Props) => {
      page.props.set("ResourceWorkbench", props);
      return <div>{props.headerAction as ReactNode}</div>;
    },
    FileUploadButton: (props: Props) => {
      page.props.set("FileUploadButton", props);
      return <button type="button">Upload</button>;
    },
    LibraryFilePreview: capture("LibraryFilePreview"),
    createFileColumns: () => [],
    createFileListFn: () => async () => ({ entries: [], nextPageToken: "" }),
    useStigmer: () => ({}),
    useActiveOrgId: () => "org_acme",
    useCanCreateFile: () => page.canCreate,
  };
});

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: (kind: string, org: string, slug: string) => page.detail.push([kind, org, slug]),
  }),
}));

import { FileListPage } from "../FileListPage";
import FilesRoute from "../../../../app/library/files/page";

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.props.clear();
  page.detail.length = 0;
});

afterEach(cleanup);

describe("web Files page", () => {
  it("lists the active organization's Files with no search, and offers Upload to whoever may upload", () => {
    render(<FileListPage />);
    const workbench = page.props.get("ResourceWorkbench")!;
    expect(workbench.org).toBe("org_acme");
    expect(workbench.searchable).toBe(false);
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(page.props.get("FileUploadButton")?.org).toBe("org_acme");
  });

  it("offers no Upload to someone the server would refuse, or before it answers", () => {
    page.canCreate = { allowed: false, isLoading: true };
    render(<FileListPage />);
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it("refreshes the list after an upload", () => {
    render(<FileListPage />);
    const before = page.props.get("ResourceWorkbench")!.refetchToken;
    act(() => (page.props.get("FileUploadButton")!.onUploaded as () => void)());
    expect(page.props.get("ResourceWorkbench")!.refetchToken).not.toBe(before);
  });

  it("opens a row in the File's preview, refreshes after a change, and opens an added skill", () => {
    render(<FileListPage />);
    const file = { metadata: { id: "file_1", org: "org_acme" }, spec: { filename: "tools.zip" } };
    act(() => (page.props.get("ResourceWorkbench")!.onItemClick as (f: unknown) => void)(file));

    const preview = page.props.get("LibraryFilePreview")!;
    expect(preview.file).toBe(file);
    const before = page.props.get("ResourceWorkbench")!.refetchToken;
    act(() => (preview.onChanged as () => void)());
    expect(page.props.get("ResourceWorkbench")!.refetchToken).not.toBe(before);

    act(() => (preview.onApplied as (r: unknown) => void)({ kind: "Skill", name: "tools", org: "org_acme", slug: "tools" }));
    expect(page.detail).toEqual([["skills", "org_acme", "tools"]]);
  });

  it("is what /library/files serves", () => {
    render(<FilesRoute />);
    expect(page.props.has("ResourceWorkbench")).toBe(true);
  });
});
