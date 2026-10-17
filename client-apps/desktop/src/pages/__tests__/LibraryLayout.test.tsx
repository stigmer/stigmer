/**
 * Pins the desktop library layout's canonical org segment: a detail route
 * whose org segment is an id, or a slug the org was renamed away from, is
 * replaced (no new history entry) by the route naming the org's current
 * slug, keeping the query; a current slug and a list route are left alone.
 * The web console's library navigation pins the same behaviour.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

vi.mock("@stigmer/react-sdk", () => ({
  LibraryBreadcrumbProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  // The SDK's answer for the person's organizations: a segment that is not
  // a current slug answers the slug to replace it with.
  useCanonicalOrgSlug: (segment: string | null) =>
    segment === "org_01jaaaaaaaaaaaaaaaaaaaaaaa" || segment === "acme-old" ? "acme" : null,
}));

vi.mock("../library/LibraryBreadcrumb", () => ({
  LibraryBreadcrumb: () => null,
}));

import LibraryLayout from "../library/LibraryLayout";

function Location() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}|{useNavigationType()}
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="library" element={<LibraryLayout />}>
          <Route path="agents" element={null} />
          <Route path="agents/:org/:slug" element={null} />
        </Route>
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("desktop LibraryLayout — canonical org segment", () => {
  it("replaces an org id with the org's slug, keeping the query", async () => {
    renderAt(`/library/agents/${ACME_ID}/helper?tab=channels`);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/library/agents/acme/helper?tab=channels|REPLACE",
      ),
    );
  });

  it("replaces a slug the org was renamed away from", async () => {
    renderAt("/library/agents/acme-old/helper");

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/library/agents/acme/helper|REPLACE",
      ),
    );
  });

  it("leaves a current slug and a list route alone", () => {
    renderAt("/library/agents/acme/helper");
    expect(screen.getByTestId("location").textContent).toBe("/library/agents/acme/helper|POP");
    cleanup();

    renderAt("/library/agents");
    expect(screen.getByTestId("location").textContent).toBe("/library/agents|POP");
  });
});
