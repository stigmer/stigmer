/**
 * Pins the desktop workflow run list's row navigation: a row opens its run's
 * page at /runs/<id> on a click and on Enter, other keys do nothing, and a
 * row whose run has no id goes nowhere. The list reads the active
 * organization's runs, 50 to a page. The data hook and the phase badge are
 * pinned in @stigmer/react; here the hook returns fixed rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface Row {
  metadata?: { id?: string; name?: string };
}

const page = vi.hoisted(() => ({
  runs: [] as Row[],
  listedWith: [] as Array<{ pageSize: number; org: string }>,
}));

vi.mock("@stigmer/react", () => ({
  Button: () => null,
  WorkflowRunPhaseBadge: () => null,
  useActiveOrgId: () => "org_acme",
  useWorkflowRunList: (options: { pageSize: number; org: string }) => {
    page.listedWith.push(options);
    return {
      runs: page.runs,
      isLoading: false,
      error: null,
      hasMore: false,
      loadMore: () => undefined,
      isLoadingMore: false,
      loadMoreError: null,
    };
  },
}));

import WorkflowRunListPage from "../workflow/WorkflowRunListPage";

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={["/library/workflows/runs"]}>
      <Routes>
        <Route path="/library/workflows/runs" element={<WorkflowRunListPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

beforeEach(() => {
  page.runs = [];
  page.listedWith.length = 0;
});

describe("desktop WorkflowRunListPage — opening a run", () => {
  it("lists the active organization's runs, 50 to a page", () => {
    renderList();

    expect(page.listedWith.at(-1)).toEqual({ pageSize: 50, org: "org_acme" });
  });

  it("opens a run's page when its row is clicked", () => {
    page.runs = [{ metadata: { id: "wfr_1", name: "nightly digest" } }];
    renderList();

    fireEvent.click(screen.getByRole("link", { name: /nightly digest/ }));

    expect(location()).toBe("/runs/wfr_1");
  });

  it("opens a run's page on Enter and ignores other keys", () => {
    page.runs = [{ metadata: { id: "wfr_2", name: "weekly report" } }];
    renderList();
    const row = screen.getByRole("link", { name: /weekly report/ });

    fireEvent.keyDown(row, { key: " " });
    expect(location()).toBe("/library/workflows/runs");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(location()).toBe("/runs/wfr_2");
  });

  it("goes nowhere from a row whose run has no id", () => {
    page.runs = [{ metadata: { name: "unsaved" } }];
    renderList();
    const row = screen.getByRole("link", { name: /unsaved/ });

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(location()).toBe("/library/workflows/runs");
  });
});
