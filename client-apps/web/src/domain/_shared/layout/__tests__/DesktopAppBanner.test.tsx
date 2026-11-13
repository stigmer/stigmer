// ---------------------------------------------------------------------------
// The Stigmer Desktop banner's two acts
//
// The banner names Stigmer Desktop and offers exactly two acts: "Download"
// starts the desktop download, and the "Dismiss" icon button hands control
// back to the shell's dismiss handler (which records the campaign-scoped
// dismissal). The download itself is lib/desktop-download's, pinned by its
// own suite; here it is stubbed so the click is observable.
// ---------------------------------------------------------------------------

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { triggerDesktopDownload } from "@/lib/desktop-download";
import { DesktopAppBanner } from "../DesktopAppBanner";

vi.mock("@/lib/desktop-download", () => ({
  triggerDesktopDownload: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(triggerDesktopDownload).mockClear();
});

describe("DesktopAppBanner", () => {
  it("names Stigmer Desktop and starts the download on Download", () => {
    const onDismiss = vi.fn();
    render(<DesktopAppBanner onDismiss={onDismiss} />);

    const banner = screen.getByRole("complementary", { name: "Desktop app" });
    expect(banner.textContent).toContain("Stigmer Desktop");

    fireEvent.click(screen.getByRole("button", { name: /Download/ }));

    expect(triggerDesktopDownload).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("hands Dismiss to the shell's dismiss handler without downloading", () => {
    const onDismiss = vi.fn();
    render(<DesktopAppBanner onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(triggerDesktopDownload).not.toHaveBeenCalled();
  });
});
