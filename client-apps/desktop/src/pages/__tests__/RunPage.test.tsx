/**
 * Pins the desktop run page's wiring: /runs/<id> hands the run named by its
 * route to the kit's run view, with the desktop's dashboard address, and
 * replaces itself with the session page the view resolves. The view's own
 * states (nothing while resolving, not found, a failed read with Try again)
 * are pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect } from "react";

const view = vi.hoisted(() => ({
  runIds: [] as string[],
  dashboardHrefs: [] as string[],
  sessionFor: new Map<string, string>(),
}));

vi.mock("@stigmer/react-sdk/console", () => ({
  RunResolveView: ({
    runId,
    onResolved,
    dashboardHref,
  }: {
    runId: string;
    onResolved: (sessionId: string) => void;
    dashboardHref: string;
  }) => {
    view.runIds.push(runId);
    view.dashboardHrefs.push(dashboardHref);
    const sessionId = view.sessionFor.get(runId);
    useEffect(() => {
      if (sessionId) onResolved(sessionId);
    }, [sessionId, onResolved]);
    return <p>run view</p>;
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
  view.runIds.length = 0;
  view.dashboardHrefs.length = 0;
  view.sessionFor.clear();
});

describe("desktop RunPage", () => {
  it("hands the route's run to the kit's view, with the desktop's dashboard", () => {
    renderAt("/runs/run_missing");

    expect(screen.getByText("run view")).toBeTruthy();
    expect(view.runIds).toContain("run_missing");
    expect(view.dashboardHrefs).toContain("/dashboard");
  });

  it("opens the session the run ran in", async () => {
    view.sessionFor.set("run_1", "ses_1");
    renderAt("/runs/run_1");

    expect(await screen.findByText("session page")).toBeTruthy();
  });
});
