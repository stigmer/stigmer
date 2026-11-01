/**
 * SettingsOverview, the settings landing both clients draw: inside the
 * settings frame, each group the navigation holds with its description,
 * and each page as the host's own link (`renderLink`), named by its route's
 * basename as the sidebar names its rows. With no groups passed it draws
 * the permission-aware navigation, so a page the person may not open is
 * never offered here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { SettingsNavGroup } from "../settings-nav";
import type { SidebarLinkRenderProps } from "../../sidebar/types";

function icon(name: string) {
  function NavIcon({ className }: { className?: string }) {
    return <svg data-testid={`icon-${name}`} className={className} />;
  }
  return NavIcon;
}

const GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Organization",
    description: "Your organization's profile and members.",
    items: [
      { href: "/settings/org-profile", label: "Org Profile", icon: icon("profile") },
      { href: "/settings/members", label: "Members", icon: icon("members") },
    ],
  },
  {
    label: "Account",
    description: "Your own settings.",
    items: [{ href: "/settings/memory", label: "Memory", icon: icon("memory") }],
  },
];

const nav = vi.hoisted(() => ({ groups: [] as readonly SettingsNavGroup[] }));
vi.mock("../useSettingsNavGroups.js", () => ({ useSettingsNavGroups: () => nav.groups }));

import { SettingsOverview } from "../SettingsOverview";

afterEach(() => {
  cleanup();
  nav.groups = [];
});

/** A host's link: an anchor carrying what the overview hands it, and a record of each call. */
function recordingLink(calls: SidebarLinkRenderProps[]) {
  return (props: SidebarLinkRenderProps) => {
    calls.push(props);
    return (
      <a href={props.href} className={props.className} data-row={props.id}>
        {props.children}
      </a>
    );
  };
}

describe("SettingsOverview", () => {
  it("opens with the settings frame's heading and draws each group with its description", () => {
    render(<SettingsOverview groups={GROUPS} renderLink={recordingLink([])} />);
    const region = screen.getByRole("region", { name: "Settings" });
    expect(within(region).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Settings"]);
    expect(within(region).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Organization",
      "Account",
    ]);
    expect(screen.getByText("Your organization's profile and members.")).toBeTruthy();
    expect(screen.getByText("Your own settings.")).toBeTruthy();
  });

  it("draws each page as the host's link, with its icon and label, named by its route's basename", () => {
    const calls: SidebarLinkRenderProps[] = [];
    render(<SettingsOverview groups={GROUPS} renderLink={recordingLink(calls)} />);
    expect(calls.map((call) => [call.id, call.href, call.active])).toEqual([
      ["org-profile", "/settings/org-profile", false],
      ["members", "/settings/members", false],
      ["memory", "/settings/memory", false],
    ]);
    const members = screen.getByRole("link", { name: "Members" });
    expect(members.getAttribute("href")).toBe("/settings/members");
    expect(within(members).getByTestId("icon-members")).toBeTruthy();
  });

  it("draws no group, and no link, when the person may see no settings page", () => {
    render(<SettingsOverview groups={[]} renderLink={recordingLink([])} />);
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("draws the navigation the person may see when no groups are passed", () => {
    nav.groups = [GROUPS[1]];
    render(<SettingsOverview renderLink={recordingLink([])} />);
    expect(screen.getByRole("link", { name: "Memory" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  });
});
