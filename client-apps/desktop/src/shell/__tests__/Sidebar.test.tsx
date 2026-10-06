// The desktop workspace sidebar's data wiring: the Conversations badge counts
// the conversations wanting a human in the active organization, asked for by
// the organization's id, and the count reaches the SDK sidebar as a prop
// (the sidebar never fetches for itself). The sidebar chrome is the SDK's,
// pinned by its own suite; here it is stubbed to read the props it is given.

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";

const shell = vi.hoisted(() => ({
  activeOrgId: "org_acme" as string | null,
  wantsHumanFor: [] as (string | null)[],
  badge: [] as (number | undefined)[],
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
  WorkspaceSidebar: ({ conversationsBadgeCount }: { conversationsBadgeCount?: number }) => {
    shell.badge.push(conversationsBadgeCount);
    return null;
  },
}));

vi.mock("../UserMenu", () => ({ UserMenu: () => null }));

vi.mock("../../hooks/EmbeddedRunnerContext", () => ({
  useRunner: () => ({ activeSessions: [] }),
}));

function renderSidebar(): void {
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  shell.activeOrgId = "org_acme";
  shell.wantsHumanFor.length = 0;
  shell.badge.length = 0;
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
