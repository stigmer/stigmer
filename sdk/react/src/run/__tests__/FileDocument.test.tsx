/**
 * The editor-pane document over one File: toolbar (name, Download, Copy
 * once text arrives), the File's text read through the Files API, Agent
 * detection with its Apply CTA, an image drawn from its download link, a
 * binary File offering only its download, Delete only where the host asks
 * for it and the server allows it, and "Add as skill" only for a `.zip`
 * File in an organization where the caller may create skills.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { toast } from "../../feedback/toast";
import { FileDocument } from "../FileDocument";

vi.mock("../../feedback/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function fileArtifact(filename: string, mimeType = "") {
  return create(FileSchema, {
    metadata: { id: `file_${filename.replace(/\W/g, "_")}` },
    spec: { filename, mimeType },
    status: { sizeBytes: 64n, runId: "aex_1", outputPath: filename },
  });
}

function stigmerReturning(text: string): Stigmer {
  return {
    file: {
      getContent: vi.fn().mockResolvedValue({
        data: new TextEncoder().encode(text),
        truncated: false,
      }),
    },
  } as unknown as Stigmer;
}

function renderDoc(stigmer: Stigmer, artifact = fileArtifact("notes.txt")) {
  return render(
    <StigmerContext.Provider value={stigmer}>
      <FileDocument
        file={artifact}
        org="acme"
        isTerminal
      />
    </StigmerContext.Provider>,
  );
}

const AGENT_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Agent",
  "metadata:",
  "  name: my-agent",
  "spec: {}",
  "",
].join("\n");

afterEach(cleanup);

describe("FileDocument", () => {
  it("renders the toolbar (name + Download) and the fetched content", async () => {
    renderDoc(stigmerReturning("hello document"));

    expect(screen.getByRole("article", { name: "File notes.txt" })).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.getByText("Download")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/hello document/)).toBeTruthy());
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("surfaces resource detection and an Apply CTA for a detected Agent", async () => {
    renderDoc(stigmerReturning(AGENT_YAML), fileArtifact("agent.yaml"));

    await waitFor(() => expect(screen.getByText("Agent detected")).toBeTruthy());
    expect(screen.getByText("Apply to acme")).toBeTruthy();
  });

  it("renders a binary File with Download and no Copy, reading no bytes", () => {
    const stigmer = stigmerReturning("");
    renderDoc(stigmer, fileArtifact("report.pdf", "application/pdf"));

    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.queryByText("Copy")).toBeNull();
    expect((stigmer.file.getContent as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("draws an image from its download link, reading no bytes through the API", async () => {
    const getDownloadUrl = vi.fn().mockResolvedValue({ url: "https://files.test/photo.png" });
    const getContent = vi.fn();
    const stigmer = { file: { getContent, getDownloadUrl } } as unknown as Stigmer;
    renderDoc(stigmer, fileArtifact("photo.png", "image/png"));

    const image = await screen.findByRole("img", { name: "photo.png" });
    expect(image.getAttribute("src")).toBe("https://files.test/photo.png");
    expect(getContent).not.toHaveBeenCalled();
  });

  it("offers Delete only when the host asks for it and the server allows it, and deletes on confirm", async () => {
    const checkMyPermission = vi.fn().mockResolvedValue({ isAuthorized: true });
    const remove = vi.fn().mockResolvedValue({});
    const onDeleted = vi.fn();
    const stigmer = {
      file: { getContent: vi.fn().mockReturnValue(new Promise(() => {})), delete: remove },
      grant: { checkMyPermission },
    } as unknown as Stigmer;

    const { unmount } = renderDoc(stigmer);
    expect(screen.queryByText("Delete")).toBeNull();
    unmount();

    render(
      <StigmerContext.Provider value={stigmer}>
        <FileDocument file={fileArtifact("notes.txt")} org="acme" isTerminal onDeleted={onDeleted} />
      </StigmerContext.Provider>,
    );
    fireEvent.click(await screen.findByText("Delete"));
    expect(screen.getByText("Delete this file?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith("file_notes_txt");
  });

  it("toasts the server's refusal when a routine still names the File, and keeps the document", async () => {
    const stigmer = {
      file: {
        getContent: vi.fn().mockReturnValue(new Promise(() => {})),
        delete: vi.fn().mockRejectedValue(new Error("the routine nightly-ledger names this File")),
      },
      grant: { checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: true }) },
    } as unknown as Stigmer;
    const onDeleted = vi.fn();
    render(
      <StigmerContext.Provider value={stigmer}>
        <FileDocument file={fileArtifact("notes.txt")} org="acme" isTerminal onDeleted={onDeleted} />
      </StigmerContext.Provider>,
    );
    fireEvent.click(await screen.findByText("Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0]![1]?.description).toContain("nightly-ledger");
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("offers Add as skill for a .zip File only, and pushes it with the tag given", async () => {
    const checkMyPermission = vi.fn().mockResolvedValue({ isAuthorized: true });
    const pushFromFile = vi.fn().mockResolvedValue({ metadata: { name: "ledger-tools", org: "org_acme", slug: "ledger-tools" } });
    const onApplied = vi.fn();
    const stigmer = {
      file: { getContent: vi.fn().mockReturnValue(new Promise(() => {})) },
      grant: { checkMyPermission },
      skill: { pushFromFile },
    } as unknown as Stigmer;
    const zip = create(FileSchema, {
      metadata: { id: "file_zip", org: "org_acme" },
      spec: { filename: "ledger-tools.zip", mimeType: "application/zip" },
      status: { sizeBytes: 64n },
    });

    const { unmount } = render(
      <StigmerContext.Provider value={stigmer}>
        <FileDocument file={create(FileSchema, { metadata: { id: "file_txt", org: "org_acme" }, spec: { filename: "notes.txt" } })} org="acme" isTerminal />
      </StigmerContext.Provider>,
    );
    expect(screen.queryByText("Add as skill")).toBeNull();
    unmount();

    render(
      <StigmerContext.Provider value={stigmer}>
        <FileDocument file={zip} org="acme" isTerminal onApplied={onApplied} />
      </StigmerContext.Provider>,
    );
    fireEvent.click(await screen.findByText("Add as skill"));
    fireEvent.change(screen.getByLabelText("Skill tag (optional)"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(pushFromFile.mock.calls[0]![0]).toMatchObject({ org: "org_acme", fileId: "file_zip", tag: "v1" });
    expect(screen.getByText(/Skill added/)).toBeTruthy();
  });

  it("downloads the File by its id and filename when Download is clicked", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const getDownloadUrl = vi.fn().mockResolvedValue({ url: "https://files.test/notes.txt" });
    const stigmer = { file: { getContent: vi.fn().mockReturnValue(new Promise(() => {})), getDownloadUrl } } as unknown as Stigmer;
    renderDoc(stigmer);

    fireEvent.click(screen.getByText("Download"));

    expect(getDownloadUrl).toHaveBeenCalledWith("file_notes_txt");
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    anchorClick.mockRestore();
  });
});
