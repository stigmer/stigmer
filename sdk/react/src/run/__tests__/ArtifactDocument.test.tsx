/**
 * The editor-pane document over an output File: toolbar (name, Download,
 * Copy once text arrives), the File's text read through the Files API,
 * Agent detection with its Apply CTA, and a binary File offering only its
 * download.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { ArtifactDocument } from "../ArtifactDocument";

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
      <ArtifactDocument
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

describe("ArtifactDocument", () => {
  it("renders the toolbar (name + Download) and the fetched content", async () => {
    renderDoc(stigmerReturning("hello document"));

    expect(screen.getByRole("article", { name: "Artifact notes.txt" })).toBeTruthy();
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
    renderDoc(stigmer, fileArtifact("photo.png", "image/png"));

    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.queryByText("Copy")).toBeNull();
    expect((stigmer.file.getContent as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
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
