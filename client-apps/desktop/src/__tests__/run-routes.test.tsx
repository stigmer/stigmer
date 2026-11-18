/**
 * Pins the desktop router's run address: /runs/<id> (where the dashboard
 * and a routine's runs send a person) renders the run page, and the
 * Library's routine addresses (list, new, detail) render their pages. The page loads
 * lazily, so the test renders the matched route's element and waits for
 * the page; the page itself is stubbed and pinned by its own suite. The
 * route saved at the last launch is reopened only while the app still
 * routes it, so a saved address the app no longer routes opens the home
 * screen. Inside the shell, an address that leads nowhere draws the kit's
 * not-found page and a page that throws draws its failure, both on a
 * pathless route under the shell's layout so the sidebar stays.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, RouterProvider, createMemoryRouter, matchRoutes } from "react-router-dom";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ onOpenUrl: vi.fn() }));
vi.mock("@choochmeque/tauri-plugin-notifications-api", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
  onNotificationClicked: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ listen: vi.fn().mockResolvedValue(() => {}) })),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));

vi.mock("../pages/runs/RunPage", () => ({
  default: () => <p>run page</p>,
}));
vi.mock("../pages/library/RoutineListPage", () => ({ default: () => <p>routine list page</p> }));
vi.mock("../pages/library/RoutineNewPage", () => ({ default: () => <p>routine new page</p> }));
vi.mock("../pages/library/RoutineDetailPage", () => ({ default: () => <p>routine detail page</p> }));

import { restorableRoute, router, startOnAnotherServer } from "../routes";

function renderRoute(path: string): void {
  const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
  expect(leaf, `no desktop route matches ${path}`).toBeDefined();
  render(<MemoryRouter initialEntries={[path]}>{leaf?.element}</MemoryRouter>);
}

describe("desktop routes — the run address", () => {
  it("renders the run page at /runs/<id>", async () => {
    renderRoute("/runs/run_1");

    expect(await screen.findByText("run page")).toBeTruthy();
  });
});

describe("desktop routes — routines in the Library", () => {
  it("renders the routine list, new and detail pages at their addresses", async () => {
    renderRoute("/library/routines");
    expect(await screen.findByText("routine list page")).toBeTruthy();
    renderRoute("/library/routines/new");
    expect(await screen.findByText("routine new page")).toBeTruthy();
    renderRoute("/library/routines/acme/nightly");
    expect(await screen.findByText("routine detail page")).toBeTruthy();
  });
});

describe("desktop routes — the route reopened at launch", () => {
  it("reopens a saved route the app still routes", () => {
    expect(restorableRoute("/runs/run_1")).toBe("/runs/run_1");
    expect(restorableRoute("/sessions/ses_1")).toBe("/sessions/ses_1");
  });

  it("opens the home screen for a saved route the app no longer routes", () => {
    expect(restorableRoute("/executions/run_1")).toBeUndefined();
    expect(restorableRoute("/no-such-screen")).toBeUndefined();
  });

  it("opens the home screen when nothing, or home, was saved", () => {
    expect(restorableRoute(null)).toBeUndefined();
    expect(restorableRoute("/")).toBeUndefined();
  });

  it("forgets the saved route and opens the home screen when the person moves to another server", async () => {
    await router.navigate("/sessions/ses_1");
    expect(localStorage.getItem("stigmer:lastRoute")).toBe("/sessions/ses_1");

    await startOnAnotherServer();

    expect(router.state.location.pathname).toBe("/");
    expect(localStorage.getItem("stigmer:lastRoute")).toBeNull();
  });
});

describe("desktop routes — the shell's own states", () => {
  it("says there's nothing at an address that leads nowhere, inside the shell", () => {
    const matched = matchRoutes(router.routes, "/nowhere/at/all") ?? [];
    expect(matched.at(-1)?.route.path).toBe("*");
    // The shell's layout route frames it, so the sidebar stays.
    expect(matched[0]?.route.children).toBeDefined();
    renderRoute("/nowhere/at/all");

    expect(screen.getByText("There's nothing at this address")).toBeTruthy();
  });

  it("draws a page that broke inside the shell, on a pathless route under its layout", () => {
    const [shell] = router.routes;
    const holder = shell?.children?.[0];
    expect(holder?.path).toBeUndefined();
    expect(holder?.errorElement).toBeDefined();

    vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("a part of the page failed to draw");
    }
    const memory = createMemoryRouter(
      [{ element: <div><p>the shell</p><Outlet /></div>, children: [{ errorElement: holder?.errorElement, children: [{ path: "/", element: <Broken /> }] }] }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={memory} />);

    expect(screen.getByText("the shell")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("a part of the page failed to draw");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
