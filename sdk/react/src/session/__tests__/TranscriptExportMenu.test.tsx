// TranscriptExportMenu (stigmer/stigmer#814): the control's wiring — labels,
// action dispatch, busy state. The menu chrome itself (Base UI portal
// behavior) is the ActionMenu compound's concern; it is faked transparent
// here so the assertions target this component's own contract.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../../action-menu/ActionMenu", () => {
  function Root({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }
  return {
    ActionMenu: Object.assign(Root, {
      Trigger: ({
        children,
        "aria-label": ariaLabel,
      }: {
        children: ReactNode;
        "aria-label"?: string;
      }) => <button aria-label={ariaLabel}>{children}</button>,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Item: ({
        children,
        onSelect,
        disabled,
      }: {
        children: ReactNode;
        onSelect?: () => void;
        disabled?: boolean;
      }) => (
        <button onClick={onSelect} disabled={disabled}>
          {children}
        </button>
      ),
    }),
  };
});

const exporter = {
  copyMarkdown: vi.fn(() => Promise.resolve()),
  downloadMarkdown: vi.fn(() => Promise.resolve()),
  downloadJson: vi.fn(() => Promise.resolve()),
  isExporting: false,
  error: null as Error | null,
};
const useExportTranscript = vi.fn(
  (_sessionId: string | null, _options?: unknown) => exporter,
);
vi.mock("../useExportTranscript", () => ({
  useExportTranscript: (sessionId: string | null, options?: unknown) =>
    useExportTranscript(sessionId, options),
}));

import { TranscriptExportMenu } from "../TranscriptExportMenu";

beforeEach(() => {
  vi.clearAllMocks();
  exporter.isExporting = false;
  cleanup();
});

describe("TranscriptExportMenu", () => {
  it("offers the three export actions and dispatches to the hook", () => {
    render(<TranscriptExportMenu sessionId="ses_01" />);

    fireEvent.click(screen.getByText("Copy transcript"));
    fireEvent.click(screen.getByText("Download Markdown"));
    fireEvent.click(screen.getByText("Download JSON"));

    expect(exporter.copyMarkdown).toHaveBeenCalledTimes(1);
    expect(exporter.downloadMarkdown).toHaveBeenCalledTimes(1);
    expect(exporter.downloadJson).toHaveBeenCalledTimes(1);
  });

  it("labels the trigger for assistive tech", () => {
    render(<TranscriptExportMenu sessionId="ses_01" />);
    expect(
      screen.getByRole("button", { name: "Export transcript" }),
    ).toBeTruthy();
  });

  it("disables the actions while an export is in flight", () => {
    exporter.isExporting = true;
    render(<TranscriptExportMenu sessionId="ses_01" />);
    const item = screen.getByText("Copy transcript").closest("button");
    expect(item?.disabled).toBe(true);
  });

  it("forwards includeSuperseded to the hook", () => {
    render(<TranscriptExportMenu sessionId="ses_01" includeSuperseded />);
    expect(useExportTranscript).toHaveBeenCalledWith("ses_01", {
      includeSuperseded: true,
    });
  });
});
