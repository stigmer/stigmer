/**
 * The Library's Files: the list asks the server only for the Files of no
 * conversation, page by page; the upload button uploads each chosen file
 * as a File of no conversation, four at a time, reports each one stored,
 * and keeps a failed one listed with the server's reason; the picker a
 * routine names Files with offers the Library's Files, adds and removes
 * them, and picks what its own upload stored.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { createFileListFn, listLibraryFilesPage } from "../fileListFn";
import { FileUploadButton, LIBRARY_UPLOAD_CONCURRENCY } from "../FileUploadButton";
import { FilePicker } from "../FilePicker";

function file(id: string, filename: string) {
  return create(FileSchema, { metadata: { id, org: "org_acme" }, spec: { filename }, status: { sizeBytes: 8n } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withClient(stigmer: unknown, children: React.ReactNode) {
  return <StigmerContext.Provider value={stigmer as Stigmer}>{children}</StigmerContext.Provider>;
}

afterEach(cleanup);

describe("the Library's File list", () => {
  it("asks only for the Files of no conversation, page by page", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [file("file_1", "a.csv")], nextPageToken: "next" });
    const page = await listLibraryFilesPage({ file: { list } }, "acme", { pageToken: "tok" });

    expect(list.mock.calls[0]![0]).toMatchObject({ org: "acme", withoutSession: true, pageSize: 20, pageToken: "tok" });
    expect(page.nextPageToken).toBe("next");

    await createFileListFn({ file: { list } })({ org: "acme", pageSize: 50, pageToken: "", query: "ignored" } as never);
    expect(list.mock.calls[1]![0]).toMatchObject({ org: "acme", withoutSession: true, pageSize: 50 });
    expect(list.mock.calls[1]![0].sessionId).toBe("");
  });
});

describe("FileUploadButton", () => {
  it("uploads each chosen file as a File of no conversation, at most four at a time, and reports each stored", async () => {
    const pending = Array.from({ length: 6 }, () => deferred<ReturnType<typeof file>>());
    let call = 0;
    const uploadFile = vi.fn().mockImplementation(() => pending[call++]!.promise);
    const onUploaded = vi.fn();
    render(withClient({ file: { uploadFile } }, <FileUploadButton org="acme" onUploaded={onUploaded} />));

    const chosen = Array.from({ length: 6 }, (_, i) => new File(["x"], `f${i}.txt`, { type: "text/plain" }));
    fireEvent.change(screen.getByLabelText("Choose files to upload"), { target: { files: chosen } });

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(LIBRARY_UPLOAD_CONCURRENCY));
    expect(uploadFile.mock.calls[0]![0]).toEqual({ org: "acme", filename: "f0.txt", mimeType: "text/plain", content: chosen[0] });
    expect(uploadFile.mock.calls[0]![0].sessionId).toBeUndefined();
    expect(within(screen.getByRole("status", { name: "Uploads" })).getAllByRole("listitem")).toHaveLength(6);

    pending.forEach((p, i) => p.resolve(file(`file_${i}`, `f${i}.txt`)));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(6));
    expect(uploadFile).toHaveBeenCalledTimes(6);
    expect(screen.queryByRole("status", { name: "Uploads" })).toBeNull();
  });

  it("keeps a failed file listed with the server's reason until dismissed", async () => {
    const uploadFile = vi.fn().mockRejectedValue(new Error("the file is larger than 500 MB"));
    render(withClient({ file: { uploadFile } }, <FileUploadButton org="acme" />));

    fireEvent.change(screen.getByLabelText("Choose files to upload"), {
      target: { files: [new File(["x"], "huge.bin")] },
    });

    expect(await screen.findByText("the file is larger than 500 MB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss huge.bin" }));
    expect(screen.queryByText("huge.bin")).toBeNull();
  });
});

describe("FilePicker", () => {
  it("offers the Library's Files, adds one, and removes it", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [file("file_a", "ledger.csv"), file("file_b", "rates.csv")], nextPageToken: "" });
    const onChange = vi.fn();
    // One client for every render, as the provider gives.
    const client = { file: { list } };
    const { rerender } = render(withClient(client, <FilePicker org="acme" value={[]} onChange={onChange} />));

    expect(list.mock.calls[0]![0]).toMatchObject({ withoutSession: true });
    await screen.findByRole("option", { name: "ledger.csv" });
    fireEvent.change(screen.getByLabelText("Add a file"), { target: { value: "file_a" } });
    expect(onChange).toHaveBeenLastCalledWith(["file_a"]);

    rerender(withClient(client, <FilePicker org="acme" value={["file_a"]} onChange={onChange} />));
    const chosen = screen.getByRole("list", { name: "Chosen files" });
    expect(within(chosen).getByText("ledger.csv")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "ledger.csv" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove ledger.csv" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("picks each File its own upload stored, even when two land together", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" });
    let n = 0;
    const uploadFile = vi.fn().mockImplementation(async () => file(`file_new${++n}`, `new${n}.csv`));
    const onChange = vi.fn();
    render(withClient({ file: { list, uploadFile } }, <FilePicker org="acme" value={["file_old"]} onChange={onChange} />));

    fireEvent.change(screen.getByLabelText("Choose files to upload"), {
      target: { files: [new File(["x"], "new1.csv"), new File(["y"], "new2.csv")] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenLastCalledWith(["file_old", "file_new1", "file_new2"]);
  });
});
