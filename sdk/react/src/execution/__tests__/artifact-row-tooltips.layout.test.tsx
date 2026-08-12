// The interactive-trigger tooltip contract from the native-title sweep
// (stigmer-cloud#268), pinned in a real Chromium on ArtifactRowView. When
// an enabled control is its own tooltip trigger, keyboard FOCUS opens the
// hint too — the concrete accessibility gain over the native `title` this
// replaced, which no keyboard user ever saw. Focus-open is real focus
// machinery (Base UI opens on focus-visible), so only a real browser can
// pin it honestly.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { ArtifactRowView } from "../ArtifactRowView.js";

const ITEM = {
  name: "report.pdf",
  tooltip: "/workspace/output/report.pdf",
  subtitlePath: null,
  sizeBytes: 2048,
  isDirectory: false,
};

function renderRow() {
  const pane = document.createElement("div");
  pane.className = "stgm";
  pane.style.width = "320px";
  document.body.appendChild(pane);
  render(
    <ul>
      <ArtifactRowView
        item={ITEM}
        onOpen={() => {}}
        onDownload={() => {}}
        isDownloading={false}
      />
    </ul>,
    { container: pane },
  );
  return pane;
}

function portaledText(pane: HTMLElement): string {
  return Array.from(document.body.children)
    .filter((node) => node !== pane)
    .map((node) => node.textContent ?? "")
    .join(" ");
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("ArtifactRowView tooltips", () => {
  it("opens the full-path hint on keyboard focus — no pointer required", async () => {
    const pane = renderRow();
    expect(pane.querySelector("[title]")).toBeNull();

    // Tab reaches the open button (first focusable in the row); the
    // tooltip must follow focus per the interactive-trigger pattern.
    await userEvent.tab();
    const openButton = Array.from(pane.querySelectorAll("button")).find((el) =>
      el.textContent?.includes("report.pdf"),
    );
    expect(document.activeElement).toBe(openButton);

    await vi.waitFor(
      () => expect(portaledText(pane)).toContain("/workspace/output/report.pdf"),
      { timeout: 3000, interval: 50 },
    );
  });

  it("keeps the download hint hoverable through the wrapper span", async () => {
    const pane = renderRow();

    const download = Array.from(pane.querySelectorAll("button")).find(
      (el) => el.getAttribute("aria-label") === "Download report.pdf",
    );
    await userEvent.hover(download!.parentElement!);
    await vi.waitFor(
      () => expect(portaledText(pane)).toContain("Download"),
      { timeout: 3000, interval: 50 },
    );
    await userEvent.unhover(download!.parentElement!);
  });

  it("says 'Download ZIP' for a directory", async () => {
    const pane = document.createElement("div");
    pane.className = "stgm";
    pane.style.width = "320px";
    document.body.appendChild(pane);
    render(
      <ul>
        <ArtifactRowView
          item={{ ...ITEM, name: "bundle", tooltip: "bundle", isDirectory: true }}
          onOpen={() => {}}
          onDownload={() => {}}
          isDownloading={false}
        />
      </ul>,
      { container: pane },
    );

    const download = Array.from(pane.querySelectorAll("button")).find(
      (el) => el.getAttribute("aria-label") === "Download bundle",
    );
    await userEvent.hover(download!.parentElement!);
    await vi.waitFor(
      () => expect(portaledText(pane)).toContain("Download ZIP"),
      { timeout: 3000, interval: 50 },
    );
    await userEvent.unhover(download!.parentElement!);
  });
});
