/**
 * SettingsOverview, the settings landing both clients draw: inside the
 * settings frame, each group the navigation holds as a list of rows, each
 * page with the line that says what it is for (`{org}` read as the active
 * organization), its name the host's own link (`renderLink`), named by its
 * route's basename as the sidebar names its rows. With no groups passed it draws
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
      { href: "/settings/org-profile", label: "Organization profile", icon: icon("profile"), description: "Its name, description and logo." },
      { href: "/settings/members", label: "Members", icon: icon("members"), description: "Who belongs to {org}, and each one's role." },
    ],
  },
  {
    label: "Account",
    description: "Your own settings.",
    items: [{ href: "/settings/memory", label: "Memory", icon: icon("memory") }],
  },
];

const nav = vi.hoisted(() => ({
  groups: [] as readonly SettingsNavGroup[],
  singleOrg: false as boolean | undefined,
  activeSlug: undefined as string | undefined,
}));
vi.mock("../useSettingsNavGroups.js", () => ({ useSettingsNavGroups: () => nav.groups }));
vi.mock("../../server-info.js", () => ({ useSingleOrg: () => nav.singleOrg }));
vi.mock("../../organization/OrgProvider.js", () => ({
  useOptionalOrg: () => (nav.activeSlug ? { activeOrg: { metadata: { slug: nav.activeSlug } } } : null),
}));

import { SettingsOverview } from "../SettingsOverview";

afterEach(() => {
  cleanup();
  nav.groups = [];
  nav.singleOrg = false;
  nav.activeSlug = undefined;
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
  it("opens with the settings frame's heading and draws each group as a list of its pages, each with its line", () => {
    render(<SettingsOverview groups={GROUPS} renderLink={recordingLink([])} />);
    const region = screen.getByRole("region", { name: "Settings" });
    expect(within(region).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Settings"]);
    expect(within(region).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Organization",
      "Account",
    ]);
    expect(screen.getByRole("list", { name: "Organization" })).toBeTruthy();
    expect(screen.getByText("Its name, description and logo.")).toBeTruthy();
    // No organization known here: the line says "this organization".
    expect(screen.getByText("Who belongs to this organization, and each one's role.")).toBeTruthy();
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
    expect(within(members.closest("li") as HTMLElement).getByTestId("icon-members")).toBeTruthy();
  });

  it("names the active organization in a page's line, except on a server that holds one", () => {
    nav.activeSlug = "acme";
    render(<SettingsOverview groups={GROUPS} renderLink={recordingLink([])} />);
    expect(screen.getByText("Who belongs to acme, and each one's role.")).toBeTruthy();
    cleanup();

    nav.singleOrg = true;
    render(<SettingsOverview groups={GROUPS} renderLink={recordingLink([])} />);
    expect(screen.getByText("Who belongs to this organization, and each one's role.")).toBeTruthy();
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
