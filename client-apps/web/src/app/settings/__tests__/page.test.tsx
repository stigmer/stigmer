// ---------------------------------------------------------------------------
// The Settings landing route — one card per nav group the SDK answers
//
// The page renders what useSettingsNavGroups returns (the SDK has already
// dropped the entries the person may not see): each group as a section
// with its heading and description, and each of its items as a link to
// its route, carrying its icon and label. A group the hook leaves out
// renders nothing.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SettingsNavGroup } from "@stigmer/react-sdk";

function icon(name: string) {
  function NavIcon({ className }: { className?: string }) {
    return <svg data-testid={`icon-${name}`} className={className} />;
  }
  return NavIcon;
}

const nav = vi.hoisted(() => ({ groups: [] as SettingsNavGroup[] }));
vi.mock("@stigmer/react-sdk", () => ({
  useSettingsNavGroups: () => nav.groups,
}));

import SettingsPage from "../page";

beforeEach(() => {
  nav.groups = [
    {
      label: "Organization",
      description: "Your organization's profile and members.",
      items: [
        { href: "/settings/org-profile", label: "Profile", icon: icon("profile") },
        { href: "/settings/members", label: "Members", icon: icon("members") },
      ],
    },
    {
      label: "Account",
      description: "Your own keys and vault.",
      items: [{ href: "/settings/vaults", label: "Vaults", icon: icon("vaults") }],
    },
  ];
});

describe("Settings landing route", () => {
  it("renders each nav group as a section with its heading and description", () => {
    render(<SettingsPage />);
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["Organization", "Account"]);
    expect(screen.getByText("Your organization's profile and members.")).toBeTruthy();
    expect(screen.getByText("Your own keys and vault.")).toBeTruthy();
  });

  it("links each item to its route with its icon and label", () => {
    render(<SettingsPage />);
    const organization = screen.getByRole("heading", { name: "Organization" })
      .parentElement as HTMLElement;
    const links = within(organization).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Profile", "/settings/org-profile"],
      ["Members", "/settings/members"],
    ]);
    const profileIcon = within(links[0]).getByTestId("icon-profile");
    expect(profileIcon.getAttribute("class")).toContain("size-4");

    const account = screen.getByRole("heading", { name: "Account" }).parentElement as HTMLElement;
    expect(within(account).getByRole("link", { name: "Vaults" }).getAttribute("href")).toBe(
      "/settings/vaults",
    );
  });

  it("renders no section when the hook answers no groups", () => {
    nav.groups = [];
    render(<SettingsPage />);
    expect(screen.queryAllByRole("heading")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
