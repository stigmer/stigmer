import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FileRowView } from "../FileRowView";
import type { FileRowItem } from "../file-row-item";

const fileItem: FileRowItem = {
  name: "report.json",
  tooltip: "report.json",
  subtitlePath: null,
  sizeBytes: 2048n,
};

function renderView(
  overrides: Partial<React.ComponentProps<typeof FileRowView>> = {},
) {
  const props = {
    item: fileItem,
    onOpen: vi.fn(),
    onDownload: vi.fn(),
    isDownloading: false,
    ...overrides,
  };
  render(
    <ul>
      <FileRowView {...props} />
    </ul>,
  );
  return props;
}

afterEach(cleanup);

describe("FileRowView — the shared row primitive", () => {
  it("renders name, formatted size, and a file-type icon", () => {
    renderView();
    const open = screen.getByText("report.json").closest("button")!;
    expect(open.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("renders the disambiguation subtitle when present", () => {
    renderView({ item: { ...fileItem, subtitlePath: "analyze_code" } });
    expect(screen.getByText("analyze_code")).toBeTruthy();
  });

  it("keeps Download a SIBLING of the open button (WCAG 4.1.2)", () => {
    renderView();
    const open = screen.getByText("report.json").closest("button")!;
    const download = screen.getByLabelText("Download report.json");
    expect(download.tagName).toBe("BUTTON");
    expect(open.contains(download)).toBe(false);
  });

  it("wires open (click), activate (double-click), and download", () => {
    const props = renderView({ onActivate: vi.fn() });
    fireEvent.click(screen.getByText("report.json"));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(screen.getByText("report.json"));
    expect(props.onActivate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Download report.json"));
    expect(props.onDownload).toHaveBeenCalledTimes(1);
  });

  it("disables Download while a download is in flight", () => {
    renderView({ isDownloading: true });
    const download = screen.getByLabelText("Preparing report.json");
    expect((download as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders with no native title anywhere", () => {
    renderView();
    // The Download hint lives in the house tooltip (native titles are
    // banned); its reveal is pinned in the real-browser suite
    // (file-row-tooltips.layout.browser.test.tsx).
    expect(document.querySelector("[title]")).toBeNull();
  });
});
