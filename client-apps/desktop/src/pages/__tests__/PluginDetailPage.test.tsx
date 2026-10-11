/**
 * Pins how the desktop plugin page opens an eval try's run: a run is
 * viewed through its parent session, so the page resolves the run first
 * and navigates to `/sessions/<id>` only once the session is known; until
 * then it stays put. Remove asks first, deletes once confirmed and returns
 * to the plugins list; a failed delete stays on the page (the delete hook
 * shows its own error), and a declined one deletes nothing. The detail
 * view is pinned in @stigmer/react; here it
 * is stubbed to capture its props, and the resolve hook answers from a
 * table. Organization links are pinned in library-detail-pages.orgs.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { DetailAction } from "@stigmer/react";

interface ViewProps {
  onNavigateToRun: (runId: string) => void;
  actions: DetailAction[];
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  resolving: [] as Array<string | null>,
  sessionFor: new Map<string, string>(),
  confirms: [] as Array<{ title: string; description: string }>,
  confirmAnswer: true,
  deletes: 0,
  deleteFails: false,
}));

vi.mock("@stigmer/react", () => {
  const noop = () => undefined;
  return {
    PluginDetailView: (props: ViewProps) => {
      page.view.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (options: { title: string; description: string }) => {
        page.confirms.push(options);
        return page.confirmAnswer;
      },
      handleConfirm: noop,
      handleCancel: noop,
    }),
    useDeleteResource: () => ({
      deleteResource: async () => {
        page.deletes += 1;
        if (page.deleteFails) throw new Error("refused");
      },
      isDeleting: false,
    }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    // The create-from-tools gate (its own suite pins both answers).
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => ({ allowed: true, isLoading: false }),
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
  page.confirms.length = 0;
  page.confirmAnswer = true;
  page.deletes = 0;
  page.deleteFails = false;
});

async function removePlugin(): Promise<void> {
  const remove = page.view.at(-1)?.actions.find((action) => action.id === "remove");
  expect(remove, "no Remove action").toBeDefined();
  await act(async () => {
    // onAction is typed void; the page's handler returns its promise.
    await Promise.resolve(remove!.onAction());
  });
}

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

describe("desktop PluginDetailPage — Remove", () => {
  it("asks first, deletes once confirmed, and returns to the plugins list", async () => {
    renderPage();

    await removePlugin();

    expect(page.confirms[0]).toMatchObject({ title: "Remove Plugin?" });
    expect(page.confirms[0]!.description).toMatch(/^Removes the plugin and its versions\./);
    expect(page.deletes).toBe(1);
    expect(screen.getByTestId("location").textContent).toBe("/library/plugins");
  });

  it("stays on the plugin when the delete fails", async () => {
    page.deleteFails = true;
    renderPage();

    await removePlugin();

    expect(page.deletes).toBe(1);
    expect(screen.getByTestId("location").textContent).toBe("/library/plugins/acme/thermos");
  });

  it("deletes nothing when the person declines", async () => {
    page.confirmAnswer = false;
    renderPage();

    await removePlugin();

    expect(page.deletes).toBe(0);
    expect(screen.getByTestId("location").textContent).toBe("/library/plugins/acme/thermos");
  });
});
