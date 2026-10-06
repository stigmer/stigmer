/**
 * Pins the web console's workflow run list addresses: the library's
 * /library/workflows/runs page renders the run list, and the old
 * /workflows/executions address redirects there, so a bookmark from before
 * the rename still lands on the list. The list itself is pinned in
 * domain/workflow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ redirects: [] as string[] }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    nav.redirects.push(url);
  },
}));

vi.mock("@/domain/workflow/WorkflowRunListPage", () => ({
  WorkflowRunListPage: () => <p>workflow run list</p>,
}));

import WorkflowRunsPage from "../app/library/workflows/runs/page";
import RunsRedirect from "../app/workflows/executions/page";

beforeEach(() => {
  nav.redirects.length = 0;
});

describe("workflow run list pages", () => {
  it("renders the run list at /library/workflows/runs", () => {
    render(<WorkflowRunsPage />);

    expect(screen.getByText("workflow run list")).toBeTruthy();
  });

  it("redirects the old /workflows/executions address to the run list", () => {
    // A redirect page renders nothing: it calls redirect() and never returns.
    RunsRedirect();

    expect(nav.redirects).toEqual(["/library/workflows/runs"]);
  });
});
