/**
 * Pins how the desktop plugin page opens an eval try's run: a run is
 * viewed through its parent session, so the page resolves the run first
 * and navigates to `/sessions/<id>` only once the session is known; until
 * then it stays put. The detail view is pinned in @stigmer/react; here it
 * is stubbed to capture its props, and the resolve hook answers from a
 * table. Organization links are pinned in library-detail-pages.orgs.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const page = vi.hoisted(() => ({
  view: [] as Array<{ onNavigateToRun: (runId: string) => void }>,
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
}));

vi.mock("@stigmer/react", () => {
  const noop = () => undefined;
  return {
    PluginDetailView: (props: { onNavigateToRun: (runId: string) => void }) => {
      page.view.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({ confirmState: null, confirm: noop, handleConfirm: noop, handleCancel: noop }),
    useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    useOrgSlugForId: () => (id: string) => id,
    useResolveRunSession: (runId: string | null) => {
      page.resolving.push(runId);
      return { sessionId: runId === null ? null : (page.sessionFor.get(runId) ?? null) };
    },
  };
});

import PluginDetailPage from "../library/PluginDetailPage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/library/plugins/acme/thermos"]}>
      <Routes>
        <Route path="/library/plugins/:org/:slug" element={<PluginDetailPage />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function openRun(runId: string): void {
  const view = page.view.at(-1);
  expect(view, "PluginDetailView was never rendered").toBeDefined();
  act(() => view!.onNavigateToRun(runId));
}

beforeEach(() => {
  page.view.length = 0;
  page.resolving.length = 0;
  page.sessionFor.clear();
});

describe("desktop PluginDetailPage — an eval try's run", () => {
  it("opens the run's session once it resolves", () => {
    page.sessionFor.set("run_1", "ses_1");
    renderPage();

    openRun("run_1");

    expect(page.resolving).toContain("run_1");
    expect(screen.getByTestId("location").textContent).toBe("/sessions/ses_1");
  });

  it("stays on the plugin while the run's session is not yet known", () => {
    renderPage();

    openRun("run_unresolved");

    expect(page.resolving).toContain("run_unresolved");
    expect(screen.getByTestId("location").textContent).toBe("/library/plugins/acme/thermos");
  });
});
