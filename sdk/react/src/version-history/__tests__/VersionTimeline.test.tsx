/**
 * Pins VersionTimeline's compare mode: picking a first version names it in
 * a status bar asking for the second, Cancel drops the pick, and picking a
 * second version hands both ids to onCompare and clears the bar.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VersionTimeline } from "../VersionTimeline";
import type { VersionEntry } from "../types";

afterEach(cleanup);

const ENTRIES: readonly VersionEntry[] = [
  {
    id: "sha256-aaaa1111",
    label: "aaaa111",
    timestamp: new Date("2026-10-01T10:00:00Z"),
    isCurrent: true,
  },
  {
    id: "sha256-bbbb2222",
    label: "bbbb222",
    timestamp: new Date("2026-09-01T10:00:00Z"),
  },
];

describe("VersionTimeline compare mode", () => {
  it("names the first pick in a status bar, and Cancel drops it", () => {
    const onCompare = vi.fn();
    render(<VersionTimeline entries={[...ENTRIES]} onCompare={onCompare} />);

    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("aaaa111"));

    expect(screen.getByRole("status").textContent).toContain(
      "Select another version to compare with aaaa111",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(onCompare).not.toHaveBeenCalled();
  });

  it("hands both picks to onCompare, first then second, and clears the bar", () => {
    const onCompare = vi.fn();
    render(<VersionTimeline entries={[...ENTRIES]} onCompare={onCompare} />);

    fireEvent.click(screen.getByText("aaaa111"));
    fireEvent.click(screen.getByText("bbbb222"));

    expect(onCompare).toHaveBeenCalledWith(
      "sha256-aaaa1111",
      "sha256-bbbb2222",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
