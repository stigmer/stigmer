// The desktop workspace sidebar's data wiring: the Conversations badge counts
// the conversations wanting a human in the active organization, asked for by
// the organization's id, and the count reaches the SDK sidebar as a prop
// (the sidebar never fetches for itself). The sidebar chrome is the SDK's,
// pinned by its own suite; here it is stubbed to read the props it is given.
// Opening a run page that the recents list does not hold yet puts a
// placeholder row for that run at the top, so the open run is listed before
// the next refetch brings its real row.

import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RecentActivityEntry } from "@stigmer/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";

const shell = vi.hoisted(() => ({
  activeOrgId: "org_acme" as string | null,
  wantsHumanFor: [] as (string | null)[],
  badge: [] as (number | undefined)[],
  entries: [] as Array<Pick<RecentActivityEntry, "id" | "type">>,
  optimistic: [] as Array<Record<string, unknown>>,
}));

vi.mock("@stigmer/react", () => ({
  useActiveOrgId: () => shell.activeOrgId,
  useRecentActivity: () => ({
    entries: shell.entries,
    refetch: () => undefined,
    prependOptimistic: (entry: Record<string, unknown>) => shell.optimistic.push(entry),
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

function renderSidebarAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:id" element={<Sidebar />} />
        <Route path="*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  shell.activeOrgId = "org_acme";
  shell.wantsHumanFor.length = 0;
  shell.badge.length = 0;
  shell.entries = [];
  shell.optimistic.length = 0;
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

describe("desktop Sidebar — the open run in the recents list", () => {
  it("lists a run page the recents list does not hold yet as a loading workflow run", () => {
    renderSidebarAt("/runs/wfr_new");

    expect(shell.optimistic).toEqual([
      { id: "wfr_new", type: "workflow_run", subject: "Loading\u2026" },
    ]);
  });

  it("adds no placeholder for a run the recents list already holds", () => {
    shell.entries = [{ id: "wfr_known", type: "workflow_run" }];
    renderSidebarAt("/runs/wfr_known");

    expect(shell.optimistic).toEqual([]);
  });

  it("adds no placeholder off a run page", () => {
    renderSidebarAt("/dashboard");

    expect(shell.optimistic).toEqual([]);
  });
});
