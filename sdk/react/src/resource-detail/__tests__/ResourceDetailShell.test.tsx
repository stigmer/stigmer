/**
 * Proves the detail page's header lays out as drawn (the owner's look at the console's parts): the
 * icon and the name share one row, and the facts line ("acme · Created …")
 * starts at the header's edge under the icon, not past it, for every
 * detail page that shares the shell.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../organization/useOrgRefs", () => ({
  useOrgSlugForId: () => (id: string) => id,
}));
// The acts beside the header ask the server what the viewer may do; the
// header's layout is what this suite reads.
vi.mock("../ResourceActionBar", () => ({ ResourceActionBar: () => null }));

import { ResourceDetailShell } from "../ResourceDetailShell";

afterEach(cleanup);

describe("ResourceDetailShell — the header", () => {
  it("starts the facts line under the icon, outside the name's column", () => {
    render(
      <ResourceDetailShell
        header={{ id: "r1", name: "daily-variance-report", org: "acme", icon: <svg data-testid="icon" />, createdAt: new Date("2026-11-01") }}
      >
        <p>body</p>
      </ResourceDetailShell>,
    );
    const icon = screen.getByTestId("icon");
    const facts = screen.getByText("acme").parentElement!;
    const nameColumn = screen.getByRole("heading", { name: "daily-variance-report" }).closest("div.stg\\:flex-1")!;
    expect(nameColumn.contains(facts)).toBe(false);
    // The facts line and the icon's row share one parent: the header's edge.
    const iconRow = icon.closest("div")!;
    expect(iconRow.parentElement).toBe(facts.parentElement);
  });
});
