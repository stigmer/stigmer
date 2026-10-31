/**
 * The preview's Build action (a plan's): shown only when the host passes
 * onImplement, and run before the modal closes; its Download saves the File
 * by id under its filename; read only, it offers no act on the File and asks
 * the server nothing about one. Its Copied and Applied confirmations are
 * drawn in the ready colour the theme contract measures as text in the
 * dialog, never the badge-fill green.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FilePreviewContent } from "../FilePreviewModal";

// A non-text File: FilePreviewContent skips the content read, so the
// test exercises the Implement action without any network mocking.
const binaryFile = create(FileSchema, {
  metadata: { id: "file_report" },
  spec: { filename: "report.bin" },
  status: { sizeBytes: 128n, runId: "run_1", outputPath: "report.bin" },
});

function withStigmer(children: ReactNode) {
  const client = {} as unknown as Stigmer;
  return (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("FilePreviewContent — confirmations", () => {
  const AGENT_YAML = ["apiVersion: agentic.stigmer.ai/v1", "kind: Agent", "metadata:", "  name: my-agent", "spec: {}", ""].join("\n");
  const agentFile = create(FileSchema, {
    metadata: { id: "file_agent" },
    spec: { filename: "agent.yaml" },
    status: { sizeBytes: 64n, runId: "run_1", outputPath: "agent.yaml" },
  });

  function withClient(client: unknown, children: ReactNode) {
    return <StigmerContext.Provider value={client as Stigmer}>{children}</StigmerContext.Provider>;
  }

  function readsText(text: string) {
    return vi.fn().mockResolvedValue({ data: new TextEncoder().encode(text), truncated: false });
  }

  it("confirms a copy in the measured ready colour", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(
      withClient(
        { file: { getContent: readsText("hello") } },
        <FilePreviewContent file={agentFile} org="acme" isTerminal onClose={() => {}} />,
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy content" }));
    const copied = await screen.findByRole("button", { name: "Copied to clipboard" });
    expect(copied.className.split(" ")).toContain("stg:text-status-ready");
  });

  it("confirms an applied resource in the measured ready colour", async () => {
    const apply = vi.fn().mockResolvedValue({ yamlKind: "Agent", name: "my-agent", org: "acme", slug: "my-agent" });
    render(
      withClient(
        { file: { getContent: readsText(AGENT_YAML) }, manifest: { apply } },
        <FilePreviewContent file={agentFile} org="acme" isTerminal onClose={() => {}} />,
      ),
    );

    fireEvent.click(await screen.findByText("Apply to acme"));
    const applied = await screen.findByText(/Applied/);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(applied.className.split(" ")).toContain("stg:text-status-ready");
  });
});

describe("FilePreviewContent — read only", () => {
  const archive = create(FileSchema, {
    metadata: { id: "file_skill", org: "acme" },
    spec: { filename: "triage.zip" },
    status: { sizeBytes: 2048n, runId: "run_1", outputPath: "triage.zip" },
  });

  function withPermission(checkMyPermission: () => Promise<{ isAuthorized: boolean }>, children: ReactNode) {
    const client = { grant: { checkMyPermission } } as unknown as Stigmer;
    return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  }

  it("offers adding an archive as a skill to a reader who may act on it", async () => {
    const check = vi.fn(async () => ({ isAuthorized: true }));
    render(withPermission(check, <FilePreviewContent file={archive} org="acme" isTerminal onClose={() => {}} />));
    expect(await screen.findByRole("button", { name: /Add as skill/ })).toBeTruthy();
  });

  it("offers only reading, copying and downloading when read only, and asks the server nothing about acting", async () => {
    const check = vi.fn(async () => ({ isAuthorized: true }));
    const onDeleted = vi.fn();
    render(
      withPermission(
        check,
        <FilePreviewContent file={archive} org="acme" isTerminal readOnly onClose={() => {}} onDeleted={onDeleted} />,
      ),
    );
    expect(screen.getByRole("button", { name: /Download/ })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: /Add as skill/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
});
