/**
 * Pins the desktop workflow breadcrumb's trail: nothing at the workflows
 * root; under it, "Workflows" links home, the runs section reads "Runs" and
 * links to its list when it is not the last crumb, the last crumb is the
 * current page and takes the page's own label (a loaded resource's name) in
 * place of its raw segment, and an unknown segment in the middle is dropped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const crumb = vi.hoisted(() => ({ label: null as string | null }));

vi.mock("@stigmer/react", () => ({
  useBreadcrumbLabel: () => crumb.label,
}));

import { WorkflowBreadcrumb } from "../workflow/WorkflowBreadcrumb";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WorkflowBreadcrumb />
    </MemoryRouter>,
  );
}

function trail(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.textContent?.replace("/", "").trim() ?? "");
}

beforeEach(() => {
  crumb.label = null;
});

describe("desktop WorkflowBreadcrumb", () => {
  it("shows no trail at the workflows root", () => {
    renderAt("/workflows");

    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("names the runs section Runs, as the current page", () => {
    renderAt("/workflows/runs");

    expect(trail()).toEqual(["Workflows", "Runs"]);
    expect(screen.getByRole("link", { name: "Workflows" }).getAttribute("href")).toBe("/workflows");
    expect(screen.getByText("Runs").getAttribute("aria-current")).toBe("page");
  });

  it("links the runs section and labels the last crumb with the page's own label", () => {
    crumb.label = "Nightly digest";
    renderAt("/workflows/runs/wfr_1");

    expect(trail()).toEqual(["Workflows", "Runs", "Nightly digest"]);
    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("href")).toBe("/workflows/runs");
    expect(screen.getByText("Nightly digest").getAttribute("aria-current")).toBe("page");
  });

  it("drops an unknown middle segment and shows a raw last segment without a label", () => {
    renderAt("/workflows/acme/digest");

    expect(trail()).toEqual(["Workflows", "digest"]);
  });
});
