/**
 * The Library's File parts around the list: the columns render a File's
 * name, type (a dash when it has none), size, visibility and upload age;
 * the count reads the Library's first page and says when more follow; the
 * upload gate asks `can_create_file` on the organization and stays shut
 * until the server answers; the upload button takes files dropped on it
 * and opens the chooser on a click; the picker ignores an upload that
 * lands on a File already chosen; and the Library preview re-reads its
 * File after a visibility change, so the level it shows is the stored one,
 * and closes after a delete.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerContext } from "../../context";
import { createFileColumns, describeFileType, describeUploaded } from "../fileColumns";
import { useFileCount } from "../useFileCount";
import { useCanCreateFile } from "../useCanCreateFile";
import { FileUploadButton } from "../FileUploadButton";
import { FilePicker } from "../FilePicker";

const captured = vi.hoisted(() => ({ modal: [] as Array<Record<string, unknown>>, access: [] as Array<Record<string, unknown>> }));

vi.mock("../../run/FilePreviewModal", () => ({
  FilePreviewModal: (props: Record<string, unknown>) => {
    captured.modal.push(props);
    return <div>{props.accessSlot as ReactNode}</div>;
  },
}));
vi.mock("../../access/ManageAccessButton", () => ({
  ManageAccessButton: (props: Record<string, unknown>) => {
    captured.access.push(props);
    return <button type="button">Manage access</button>;
  },
}));

import { LibraryFilePreview } from "../LibraryFilePreview";

function file(id: string, filename: string, extra: { mimeType?: string; created?: Date; visibility?: ApiResourceVisibility } = {}) {
  return create(FileSchema, {
    metadata: { id, org: "org_acme", visibility: extra.visibility ?? ApiResourceVisibility.visibility_private },
    spec: { filename, mimeType: extra.mimeType ?? "" },
    status: {
      sizeBytes: 2048n,
      audit: extra.created ? { specAudit: { createdAt: timestampFromDate(extra.created) } } : undefined,
    },
  });
}

function wrapper(stigmer: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={stigmer as Stigmer}>{children}</StigmerContext.Provider>;
  };
}

afterEach(() => {
  cleanup();
  captured.modal.length = 0;
  captured.access.length = 0;
});

describe("the Library's File columns", () => {
  it("render the name, type, size, visibility and upload age", () => {
    const shown = file("file_1", "ledger.csv", { mimeType: "text/csv", created: new Date(Date.now() - 3 * 3_600_000), visibility: ApiResourceVisibility.visibility_org });
    const columns = createFileColumns();
    expect(columns.map((c) => c.header)).toEqual(["Name", "Type", "Size", "Visibility", "Uploaded"]);
    render(<div>{columns.map((c) => <div key={c.id}>{c.cell(shown)}</div>)}</div>);
    expect(screen.getByText("ledger.csv")).toBeTruthy();
    expect(screen.getByText("text/csv")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("Organization")).toBeTruthy();
    expect(screen.getByText("3h")).toBeTruthy();
  });

  it("say a dash for a File with no type or no upload time", () => {
    const bare = file("file_2", "blob");
    expect(describeFileType(bare)).toBe("—");
    expect(describeUploaded(bare)).toBe("—");
    render(<div>{createFileColumns().find((c) => c.id === "visibility")!.cell(create(FileSchema, {}))}</div>);
  });
});

describe("useFileCount", () => {
  it("counts the Library's first page and says when more follow", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [file("a", "a"), file("b", "b")], nextPageToken: "more" });
    const { result } = renderHook(() => useFileCount("acme"), { wrapper: wrapper({ file: { list } }) });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.isLowerBound).toBe(true);
    expect(list.mock.calls[0]![0]).toMatchObject({ org: "acme", withoutSession: true, pageSize: 100 });
  });

  it("reads nothing without an organization", () => {
    const list = vi.fn();
    const { result } = renderHook(() => useFileCount(null), { wrapper: wrapper({ file: { list } }) });
    expect(result.current.count).toBeUndefined();
    expect(result.current.isLowerBound).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("useCanCreateFile", () => {
  it("asks can_create_file on the organization and stays shut until the server answers", async () => {
    const checkMyPermission = vi.fn().mockResolvedValue({ isAuthorized: true });
    const { result } = renderHook(() => useCanCreateFile("org_acme"), { wrapper: wrapper({ grant: { checkMyPermission } }) });
    expect(result.current.allowed).toBe(false);
    await waitFor(() => expect(result.current.allowed).toBe(true));
    expect(checkMyPermission.mock.calls[0]![0]).toMatchObject({ relation: "can_create_file", resource: { kind: "organization", id: "org_acme" } });
  });

  it("allows nothing without an organization", () => {
    const { result } = renderHook(() => useCanCreateFile(null), { wrapper: wrapper({ grant: { checkMyPermission: vi.fn() } }) });
    expect(result.current).toEqual({ allowed: false, isLoading: false });
  });
});

describe("FileUploadButton's drop target and chooser", () => {
  it("uploads the files dropped on it, and marks itself while one is dragged over", async () => {
    const uploadFile = vi.fn().mockResolvedValue(file("file_drop", "drop.txt"));
    const onUploaded = vi.fn();
    render(<FileUploadButton org="acme" onUploaded={onUploaded} />, { wrapper: wrapper({ file: { uploadFile } }) });
    const button = screen.getByRole("button", { name: "Upload" });

    fireEvent.dragOver(button);
    expect(button.className).toContain("stg:ring-offset-2");
    fireEvent.dragLeave(button);
    expect(button.className).not.toContain("stg:ring-offset-2");

    fireEvent.drop(button, { dataTransfer: { files: [new File(["x"], "drop.txt")] } });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    fireEvent.drop(button, { dataTransfer: { files: [] } });
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("opens the system chooser on a click", () => {
    render(<FileUploadButton org="acme" />, { wrapper: wrapper({ file: { uploadFile: vi.fn() } }) });
    const input = screen.getByLabelText("Choose files to upload") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("FilePicker", () => {
  it("leaves the choice alone when an upload lands on a File already chosen", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" });
    const uploadFile = vi.fn().mockResolvedValue(file("file_old", "old.csv"));
    const onChange = vi.fn();
    render(<FilePicker org="acme" value={["file_old"]} onChange={onChange} />, { wrapper: wrapper({ file: { list, uploadFile } }) });

    fireEvent.change(screen.getByLabelText("Choose files to upload"), { target: { files: [new File(["x"], "old.csv")] } });

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("LibraryFilePreview", () => {
  it("shows the stored File, re-reads it after a visibility change, and closes after a delete", async () => {
    const opened = file("file_1", "ledger.csv");
    const get = vi
      .fn()
      .mockResolvedValueOnce(file("file_1", "ledger.csv"))
      .mockResolvedValueOnce(file("file_1", "ledger.csv", { visibility: ApiResourceVisibility.visibility_org }));
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(<LibraryFilePreview file={opened} onClose={onClose} onChanged={onChanged} />, {
      wrapper: wrapper({ file: { get } }),
    });

    expect(screen.getByRole("button", { name: "Manage access" })).toBeTruthy();
    expect(captured.access.at(-1)).toMatchObject({ resource: { kindString: "file", id: "file_1", org: "org_acme" } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    (captured.access.at(-1)!.visibility as { onChanged: () => void }).onChanged();
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect((captured.access.at(-1)!.visibility as { current: ApiResourceVisibility }).current).toBe(
        ApiResourceVisibility.visibility_org,
      ),
    );

    (captured.modal.at(-1)!.onDeleted as () => void)();
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
