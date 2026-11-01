/**
 * The desktop settings landing: the kit's overview, each row a router link
 * to its route. What the overview draws (its groups, and only the pages
 * the person may open) is pinned by the kit's own suite; this pins the
 * seam the app owns, the same one the web console's landing fills with a
 * Next.js link.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SidebarLinkRenderProps } from "@stigmer/react-sdk/console";

const ROWS: readonly SidebarLinkRenderProps[] = [
  {
    id: "members",
    href: "/settings/members",
    active: false,
    className: "row-look",
    "aria-current": undefined,
    children: <span>Members</span>,
  },
];

vi.mock("@stigmer/react-sdk/console", () => ({
  SettingsOverview: ({ renderLink }: { renderLink: (props: SidebarLinkRenderProps) => React.ReactElement }) => (
    <div>{ROWS.map((row) => renderLink(row))}</div>
  ),
}));

import SettingsLanding from "../settings/SettingsLanding";

describe("SettingsLanding", () => {
  it("draws the kit's overview, each row a router link to its route with the row's look", () => {
    render(
      <MemoryRouter>
        <SettingsLanding />
      </MemoryRouter>,
    );
    const members = screen.getByRole("link", { name: "Members" });
    expect(members.getAttribute("href")).toBe("/settings/members");
    expect(members.getAttribute("class")).toBe("row-look");
  });
});
