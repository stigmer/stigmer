/**
 * Pins the desktop run page: /runs/<id> resolves the run named by its route
 * to the session it ran in and replaces itself with that session's page,
 * showing nothing of its own while the run resolves; a run that resolves to
 * no session shows the not-found state, and a failed read says so and
 * retries on request. The resolving hook is pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const page = vi.hoisted(() => ({
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
  pending: new Set<string>(),
  failing: new Set<string>(),
  retries: 0,
}));

vi.mock("@stigmer/react", () => ({
  useResolveRunSession: (id: string | null) => {
    page.resolving.push(id);
    return {
      sessionId: id ? (page.sessionFor.get(id) ?? null) : null,
      isLoading: id !== null && page.pending.has(id),
      error: id !== null && page.failing.has(id) ? new Error("connection refused") : null,
      refetch: () => {
        page.retries += 1;
      },
    };
  },
}));

import RunPage from "../runs/RunPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:id" element={<RunPage />} />
        <Route path="/sessions/:id" element={<p>session page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  page.resolving.length = 0;
  page.sessionFor.clear();
  page.pending.clear();
  page.failing.clear();
  page.retries = 0;
});

describe("desktop RunPage", () => {
  it("opens the session the run ran in", async () => {
    page.sessionFor.set("aex_1", "ses_1");
    renderAt("/runs/aex_1");

    expect(await screen.findByText("session page")).toBeTruthy();
    expect(page.resolving).toContain("aex_1");
  });

  it("shows nothing of its own while the run resolves", () => {
    page.pending.add("aex_2");
    renderAt("/runs/aex_2");

    expect(screen.queryByText("session page")).toBeNull();
    expect(screen.queryByText("Run not found")).toBeNull();
  });

  it("shows the not-found state when no run resolves", () => {
    renderAt("/runs/aex_missing");

    expect(screen.getByText("Run not found")).toBeTruthy();
    expect(screen.queryByText("session page")).toBeNull();
  });

  it("says the run failed to load, not that it is missing, and retries on request", () => {
    page.failing.add("aex_flaky");
    renderAt("/runs/aex_flaky");

    expect(screen.getByRole("heading", { name: "Failed to load run" })).toBeTruthy();
    expect(screen.queryByText("Run not found")).toBeNull();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(page.retries).toBe(1);
  });
});
