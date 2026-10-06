// The desktop workspace sidebar's data wiring: the Conversations badge counts
// the conversations wanting a human in the active organization, asked for by
// the organization's id, and the count reaches the SDK sidebar as a prop
// (the sidebar never fetches for itself). Each recents row's accessory marks a
// session the embedded runner is still running in the background (any session
// but the one on screen) with the background-run dot, and every other row with
// nothing. The sidebar chrome is the SDK's, pinned by its own suite; here it is
// stubbed to read the props it is given.

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { RecentActivityEntry } from "@stigmer/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";

const shell = vi.hoisted(() => ({
  activeOrgId: "org_acme" as string | null,
  wantsHumanFor: [] as (string | null)[],
  badge: [] as (number | undefined)[],
  activeSessions: [] as string[],
  accessory: undefined as ((entry: RecentActivityEntry) => ReactNode) | undefined,
}));

vi.mock("@stigmer/react", () => ({
  useActiveOrgId: () => shell.activeOrgId,
  useRecentActivity: () => ({
    entries: [],
    refetch: () => undefined,
  }),
  useConversationsWantsHumanCount: (org: string | null) => {
    shell.wantsHumanFor.push(org);
    return { count: org ? 3 : 0 };
  },
  WorkspaceSidebar: ({
    conversationsBadgeCount,
    renderEntryAccessory,
  }: {
    conversationsBadgeCount?: number;
    renderEntryAccessory?: (entry: RecentActivityEntry) => ReactNode;
  }) => {
    shell.badge.push(conversationsBadgeCount);
    shell.accessory = renderEntryAccessory;
    return null;
  },
}));

vi.mock("../UserMenu", () => ({ UserMenu: () => null }));

vi.mock("../../hooks/EmbeddedRunnerContext", () => ({
  useRunner: () => ({ activeSessions: shell.activeSessions }),
}));

function renderSidebar(path = "/dashboard"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sessions/:id" element={<Sidebar />} />
        <Route path="*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Renders the accessory the sidebar hands the SDK for a recents row. */
function renderAccessory(id: string): void {
  const accessory = shell.accessory;
  if (accessory === undefined) throw new Error("the sidebar handed no renderEntryAccessory");
  render(<>{accessory({ id, subject: id, updatedAt: new Date(0) })}</>);
}

beforeEach(() => {
  shell.activeOrgId = "org_acme";
  shell.wantsHumanFor.length = 0;
  shell.badge.length = 0;
  shell.activeSessions = [];
  shell.accessory = undefined;
});

describe("desktop Sidebar — the Conversations badge", () => {
  it("counts the active organization by id and hands the count to the SDK sidebar", () => {
    renderSidebar();

    expect(shell.wantsHumanFor.at(-1)).toBe("org_acme");
    expect(shell.badge.at(-1)).toBe(3);
  });

  it("asks for no count while no organization is active", () => {
    shell.activeOrgId = null;
    renderSidebar();

    expect(shell.wantsHumanFor.at(-1)).toBeNull();
    expect(shell.badge.at(-1)).toBe(0);
  });
});

describe("desktop Sidebar — the recents row accessory", () => {
  it("marks a session running in the background with the background-run dot", () => {
    shell.activeSessions = ["ses_background", "ses_viewed"];
    renderSidebar("/sessions/ses_viewed");

    renderAccessory("ses_background");
    expect(screen.getByRole("status", { name: "Running in background" })).toBeTruthy();
  });

  it("marks nothing on the session on screen or on a session with no live run", () => {
    shell.activeSessions = ["ses_background", "ses_viewed"];
    renderSidebar("/sessions/ses_viewed");

    renderAccessory("ses_viewed");
    renderAccessory("ses_idle");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
