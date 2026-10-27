/**
 * Pins VersionTimelineEntry's git provenance row: the ref, and the commit
 * shortened to seven characters, linked to the commit's page when the remote
 * maps to a web URL (an SSH remote included) and shown as plain text when it
 * does not.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VersionTimelineEntry } from "../VersionTimelineEntry";
import type { VersionEntry } from "../types";

afterEach(cleanup);

function entryWith(remoteUrl: string): VersionEntry {
  return {
    id: "sha256-aaaa1111",
    label: "aaaa111",
    timestamp: new Date("2026-10-01T10:00:00Z"),
    gitProvenance: { remoteUrl, ref: "main", commit: "0123456789abcdef" },
  };
}

describe("VersionTimelineEntry git provenance", () => {
  it("links the shortened commit to its page on the remote's web host", () => {
    render(
      <VersionTimelineEntry
        entry={entryWith("git@github.com:acme/skills.git")}
      />,
    );

    expect(screen.getByText("main")).toBeTruthy();
    const link = screen.getByRole("link", { name: "0123456" });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/skills/commit/0123456789abcdef",
    );
  });

  it("shows the shortened commit unlinked when the remote has no web URL", () => {
    render(<VersionTimelineEntry entry={entryWith("file:///srv/skills")} />);

    expect(screen.getByText("0123456")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
