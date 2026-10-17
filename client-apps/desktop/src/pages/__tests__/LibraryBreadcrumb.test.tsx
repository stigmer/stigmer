/**
 * The desktop Library breadcrumb: a kind's list segment reads its plural
 * label ("Routines") and links to the list, and a detail page's last segment
 * reads the label the page loaded, never the raw slug.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const label = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("@stigmer/react-sdk", () => ({ useBreadcrumbLabel: () => label.current }));

import { LibraryBreadcrumb } from "../library/LibraryBreadcrumb";

afterEach(() => {
  cleanup();
  label.current = null;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LibraryBreadcrumb />
    </MemoryRouter>,
  );
}

describe("desktop LibraryBreadcrumb", () => {
  it("names the routine list Routines", () => {
    renderAt("/library/routines");
    expect(screen.getByText("Routines")).toBeTruthy();
  });

  it("links Routines to the list and names a routine by its loaded label", () => {
    label.current = "Triage new alerts";
    renderAt("/library/routines/acme/triage");
    expect(screen.getByRole("link", { name: "Routines" }).getAttribute("href")).toBe("/library/routines");
    expect(screen.getByText("Triage new alerts")).toBeTruthy();
    expect(screen.queryByText("triage")).toBeNull();
  });
});
