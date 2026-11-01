// ---------------------------------------------------------------------------
// The Settings landing route — the kit's overview, each page a Next.js link
//
// The landing's groups, descriptions and links are the kit's
// `SettingsOverview` (its own tests pin what it draws and that it draws only
// the navigation the person may see). This route's part is the seam: every
// row the overview hands it becomes a Next.js link to the row's route,
// carrying the row's look and content, so a click moves within the app.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SidebarLinkRenderProps } from "@stigmer/react-sdk/console";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));

const ROWS: readonly SidebarLinkRenderProps[] = [
  {
    id: "members",
    href: "/settings/members",
    active: false,
    className: "row-look",
    "aria-current": undefined,
    children: <span>Members</span>,
  },
  {
    id: "memory",
    href: "/settings/memory",
    active: false,
    className: "row-look",
    "aria-current": undefined,
    children: <span>Memory</span>,
  },
];

vi.mock("@stigmer/react-sdk/console", () => ({
  SettingsOverview: ({ renderLink }: { renderLink: (props: SidebarLinkRenderProps) => React.ReactElement }) => (
    <div>{ROWS.map((row) => renderLink(row))}</div>
  ),
}));

import SettingsPage from "../page";

describe("Settings landing route", () => {
  it("draws the kit's overview, each row a Next.js link to its route with the row's look", () => {
    render(<SettingsPage />);
    const members = screen.getByRole("link", { name: "Members" });
    expect(members.getAttribute("href")).toBe("/settings/members");
    expect(members.getAttribute("class")).toBe("row-look");
    expect(members.hasAttribute("data-next-link")).toBe(true);
    expect(screen.getByRole("link", { name: "Memory" }).getAttribute("href")).toBe("/settings/memory");
  });
});
