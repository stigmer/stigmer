// Every desktop screen is on the screen list. The list
// (test/visual/screens.json) names each route the desktop app's router
// serves with the gallery scenes that draw it, or the console route whose
// view it shares, and the gallery's own test holds each to a drawing the
// maintainer passed (test/visual/src/__tests__/screens.test.ts). This half
// walks the router's tree, so a new route that nothing draws fails here,
// by name, before it ships; and a listed route the router dropped fails
// too. The console's twin is client-apps/web's screens-listed test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RouteObject } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: vi.fn(),
}));

vi.mock("@choochmeque/tauri-plugin-notifications-api", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
  onNotificationClicked: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    listen: vi.fn().mockResolvedValue(() => {}),
  })),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

// Vitest runs with cwd at client-apps/desktop.
const SCREENS_FILE = resolve(process.cwd(), "..", "..", "test", "visual", "screens.json");

/**
 * Every route the router serves a screen at: each route with a path or an
 * index and an element, by its full path. A pathless route (a layout, the
 * error boundary's holder) adds nothing to the path; `*` is the not-found
 * screen.
 */
function screenPaths(routes: readonly RouteObject[], base = ""): string[] {
  return [...new Set(collectPaths(routes, base))];
}

/** Each screen route's full path, in tree order; a layout and its index share theirs. */
function collectPaths(routes: readonly RouteObject[], base: string): string[] {
  const paths: string[] = [];
  for (const route of routes) {
    const path = route.path === undefined ? base : `${base}/${route.path}`;
    if (route.element != null && (route.index === true || route.path !== undefined)) paths.push(path === "" ? "/" : path);
    if (route.children) paths.push(...collectPaths(route.children, path));
  }
  return paths;
}

/** What a route lacks on the list, said as the fix. */
function unlisted(paths: readonly string[], listed: readonly string[]): string[] {
  return paths
    .filter((path) => !listed.includes(path))
    .map(
      (path) =>
        `${path} has no entry under "desktop" in test/visual/screens.json: draw it in the gallery and hold it to an approved drawing, ` +
        "name the console route whose view it shares, or say why it has none (test/visual/README.md, Adding a screen)",
    );
}

const listed = Object.keys((JSON.parse(readFileSync(SCREENS_FILE, "utf8")) as { desktop: Record<string, unknown> }).desktop);

// The route tree is imported once, while the file is collected, after the
// mocks above, as the settings nav test does (stigmer#2765).
const { router } = await import("../routes");

describe("DSK-08 every desktop screen is on the screen list", () => {
  it("finds the router's screens and the list", () => {
    expect(screenPaths(router.routes).length).toBeGreaterThan(40);
    expect(listed.length).toBeGreaterThan(40);
  });

  it("lists every route the desktop app serves", () => {
    expect(unlisted(screenPaths(router.routes), listed)).toEqual([]);
  });

  it("lists no route the desktop app does not serve", () => {
    const paths = screenPaths(router.routes);
    expect(listed.filter((path) => !paths.includes(path))).toEqual([]);
  });

  it("reads a nested route's full path, an index as its parent's, and skips a pathless layout", () => {
    const tree: RouteObject[] = [
      {
        element: <main />,
        children: [
          { index: true, element: <p /> },
          { path: "settings", children: [{ element: <div />, children: [{ path: "audit", element: <p /> }] }] },
          { path: "*", element: <p /> },
        ],
      },
    ];
    expect(screenPaths(tree)).toEqual(["/", "/settings/audit", "/*"]);
    expect(unlisted(["/settings/audit"], [])).toHaveLength(1);
  });
});
