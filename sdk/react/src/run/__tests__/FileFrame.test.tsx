/**
 * One frame for one File's two homes: the preview window
 * (FilePreviewContent) and the session panel's tab (FileDocument) show the
 * same header (the glyph in a muted square, the name, "{kind} · {size}" in
 * the Made cards' words, the detection tag) and the same acts in the same
 * order: at most one primary (Build or Apply, at the primary size), then
 * Copy, Download and Add as skill as small ghost buttons, Delete last in the
 * destructive colour; the window alone adds Close at the far right.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FilePreviewContent } from "../FilePreviewModal";
import { FileDocument } from "../FileDocument";

const AGENT_YAML = ["apiVersion: agentic.stigmer.ai/v1", "kind: Agent", "metadata:", "  name: my-agent", "spec: {}", ""].join("\n");

function fileNamed(filename: string, mimeType = ""): StigmerFile {
  return create(FileSchema, {
    metadata: { id: `file_${filename.replace(/\W/g, "_")}`, org: "acme" },
    spec: { filename, mimeType },
    status: { sizeBytes: 2048n, runId: "run_1", outputPath: filename },
  });
}

function client(text: string): Stigmer {
  return {
    file: { getContent: vi.fn().mockResolvedValue({ data: new TextEncoder().encode(text), truncated: false }) },
    grant: { checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: true }) },
  } as unknown as Stigmer;
}

function within(stigmer: Stigmer, children: ReactNode) {
  return <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>;
}

/** The header's buttons in order, each by its accessible name (its label, else its words). */
function headerActs(container: HTMLElement): string[] {
  const header = container.querySelector("[data-file-frame-header]")!;
  return Array.from(header.querySelectorAll("button")).map(
    (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
  );
}

/** The header's buttons drawn as the primary act. */
function primaries(container: HTMLElement): HTMLButtonElement[] {
  const header = container.querySelector("[data-file-frame-header]")!;
  return Array.from(header.querySelectorAll("button")).filter((button) => button.className.split(" ").includes("stg:bg-primary"));
}

afterEach(cleanup);

describe("FileFrame — one header for the window and the tab", () => {
  it("says the same name, kind, size and detection in both homes", async () => {
    const file = fileNamed("agent.yaml");
    const shown: string[] = [];
    for (const home of [
      <FilePreviewContent key="window" file={file} org="acme" isTerminal onClose={() => {}} onDeleted={() => {}} />,
      <FileDocument key="tab" file={file} org="acme" isTerminal onDeleted={() => {}} />,
    ]) {
      const { container, unmount } = render(within(client(AGENT_YAML), home));
      await screen.findByText("Agent detected");
      const header = container.querySelector("[data-file-frame-header]")!;
      expect(screen.getByRole("heading", { name: "agent.yaml" })).toBeTruthy();
      expect(screen.getByText("YAML · 2.0 KB")).toBeTruthy();
      expect(header.querySelector(".stg\\:size-8.stg\\:bg-muted svg")).toBeTruthy();
      shown.push(header.textContent ?? "");
      unmount();
    }
    expect(shown[0]).toBe(shown[1]);
  });

  it("orders a manifest's acts the same in both: Apply as the one primary, Copy, Download, Delete last; the window adds Close", async () => {
    const file = fileNamed("agent.yaml");
    const inWindow = render(within(client(AGENT_YAML), <FilePreviewContent file={file} org="acme" isTerminal onClose={() => {}} onDeleted={() => {}} />));
    await screen.findByText("Delete");
    await screen.findByText("Apply to acme");
    const windowActs = headerActs(inWindow.container);
    expect(primaries(inWindow.container).map((b) => b.textContent)).toEqual(["Apply to acme"]);
    expect(primaries(inWindow.container)[0]!.className.split(" ")).toContain("stg:h-8");
    inWindow.unmount();

    const tab = render(within(client(AGENT_YAML), <FileDocument file={file} org="acme" isTerminal onDeleted={() => {}} />));
    await screen.findByText("Delete");
    await screen.findByText("Apply to acme");
    const tabActs = headerActs(tab.container);
    expect(primaries(tab.container)).toHaveLength(1);

    expect(tabActs).toEqual(["Apply to acme", "Copy content", "Download", "Delete"]);
    expect(windowActs).toEqual([...tabActs, "Close preview"]);
  });

  it("orders an archive's acts the same in both: Download, Add as skill, Delete last, with no primary", async () => {
    const file = fileNamed("tools.zip", "application/zip");
    const acts: string[][] = [];
    for (const home of [
      <FilePreviewContent key="window" file={file} org="acme" isTerminal onClose={() => {}} onDeleted={() => {}} />,
      <FileDocument key="tab" file={file} org="acme" isTerminal onDeleted={() => {}} />,
    ]) {
      const { container, unmount } = render(within(client(""), home));
      await screen.findByText("Add as skill");
      await screen.findByText("Delete");
      expect(primaries(container)).toHaveLength(0);
      for (const name of ["Download", "Add as skill"]) {
        const classes = screen.getByRole("button", { name }).className.split(" ");
        expect(classes).toContain("stg:h-7");
        expect(classes).not.toContain("stg:bg-primary");
      }
      // Delete is drawn in the destructive colour.
      expect(screen.getByRole("button", { name: "Delete" }).className).toContain("stg:text-destructive");
      acts.push(headerActs(container).filter((name) => name !== "Close preview"));
      unmount();
    }
    expect(acts[0]).toEqual(["Download", "Add as skill", "Delete"]);
    expect(acts[1]).toEqual(acts[0]);
  });

  it("makes Build the window's one primary for a plan, ahead of the rest", async () => {
    const plan = fileNamed("plan.md", "text/markdown");
    const { container } = render(
      within(client("# Plan\n"), <FilePreviewContent file={plan} org="acme" isTerminal onClose={() => {}} onImplement={() => {}} />),
    );
    await screen.findByText("Copy");
    expect(primaries(container).map((b) => b.textContent)).toEqual(["Build"]);
    expect(headerActs(container)).toEqual(["Build", "Copy content", "Download", "Close preview"]);
    expect(screen.getByText("Markdown · 2.0 KB")).toBeTruthy();
  });
});
