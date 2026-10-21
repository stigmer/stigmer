/**
 * The preview's Build action (a plan's): shown only when the host passes
 * onImplement, and run before the modal closes; its Download saves the File
 * by id under its filename.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { FilePreviewContent } from "../FilePreviewModal";

// A non-text File: FilePreviewContent skips the content read, so the
// test exercises the Implement action without any network mocking.
const binaryFile = create(FileSchema, {
  metadata: { id: "file_report" },
  spec: { filename: "report.bin" },
  status: { sizeBytes: 128n, runId: "aex_1", outputPath: "report.bin" },
});

function withStigmer(children: ReactNode) {
  const client = {} as unknown as Stigmer;
  return (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
}

afterEach(cleanup);

describe("FilePreviewContent — Build action", () => {
  it("renders a 'Build' button only when onImplement is provided", () => {
    const { rerender } = render(
      withStigmer(
        <FilePreviewContent
          file={binaryFile}
          org="acme"
          isTerminal
          onClose={() => {}}
        />,
      ),
    );
    expect(screen.queryByText("Build")).toBeNull();

    rerender(
      withStigmer(
        <FilePreviewContent
          file={binaryFile}
          org="acme"
          isTerminal
          onClose={() => {}}
          onImplement={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("calls onImplement then closes the modal when 'Build' is clicked", () => {
    const calls: string[] = [];
    const onImplement = vi.fn(() => calls.push("implement"));
    const onClose = vi.fn(() => calls.push("close"));

    render(
      withStigmer(
        <FilePreviewContent
          file={binaryFile}
          org="acme"
          isTerminal
          onClose={onClose}
          onImplement={onImplement}
        />,
      ),
    );

    fireEvent.click(screen.getByText("Build"));

    expect(onImplement).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Run the plan action before tearing down the modal.
    expect(calls).toEqual(["implement", "close"]);
  });
});

describe("FilePreviewContent — Download", () => {
  it("downloads the File by its id and filename when Download is clicked", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const getDownloadUrl = vi.fn().mockResolvedValue({ url: "https://files.test/report.bin" });
    render(
      <StigmerContext.Provider value={{ file: { getDownloadUrl } } as unknown as Stigmer}>
        <FilePreviewContent file={binaryFile} org="acme" isTerminal onClose={() => {}} />
      </StigmerContext.Provider>,
    );

    fireEvent.click(screen.getByText("Download"));

    expect(getDownloadUrl).toHaveBeenCalledWith("file_report");
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(anchorClick.mock.contexts[0]).toMatchObject({ download: "report.bin" });
    anchorClick.mockRestore();
  });
});
