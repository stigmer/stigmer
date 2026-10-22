// ---------------------------------------------------------------------------
// AppShell — the signed-in shell mounts the app-wide hooks
//
// The shell runs the keyboard shortcuts, the billing return and the
// attention notifications once, and renders the session sidebar outside
// settings. The sidebars, the organization gate and the hooks are stubbed;
// each is pinned in its own suite.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mounted = vi.hoisted(() => ({ shortcuts: 0, billing: 0, attention: 0 }));
vi.mock("../../hooks/useAppShortcuts", () => ({ useAppShortcuts: () => (mounted.shortcuts += 1) }));
vi.mock("../../hooks/useDesktopBillingReturn", () => ({ useDesktopBillingReturn: () => (mounted.billing += 1) }));
vi.mock("../../hooks/useDesktopAttentionNotifications", () => ({
  useDesktopAttentionNotifications: () => (mounted.attention += 1),
}));
vi.mock("../../org/OrgGate", () => ({ OrgGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../Sidebar", () => ({ Sidebar: () => <nav>session sidebar</nav> }));
vi.mock("../ManagementSidebar", () => ({ ManagementSidebar: () => <nav>management sidebar</nav> }));

import { AppShell } from "../AppShell";

describe("AppShell", () => {
  it("mounts the shortcuts, the billing return and the attention notifications, with the session sidebar", () => {
    render(
      <MemoryRouter initialEntries={["/sessions/s1"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/sessions/:id" element={<p>the conversation</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("the conversation")).toBeTruthy();
    expect(screen.getByText("session sidebar")).toBeTruthy();
    expect([mounted.shortcuts > 0, mounted.billing > 0, mounted.attention > 0]).toEqual([true, true, true]);
  });
});
