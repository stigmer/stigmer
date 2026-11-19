// Every console screen is on the screen list. The list
// (test/visual/screens.json) names each route the console serves with the
// gallery scenes that draw it, and the gallery's own test holds each to a
// drawing the maintainer passed (test/visual/src/__tests__/screens.test.ts).
// This half walks every page file under src/app, so a new route that no
// scene draws and no reviewed line excuses fails here, by name, before it
// ships; and a listed route that no longer exists fails too, so the list
// never claims a screen the console dropped.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// Vitest runs with cwd at client-apps/web (the static-export routing suite
// resolves the app dir the same way, for the same happy-dom reason).
const APP_DIR = resolve(process.cwd(), "src", "app");
const SCREENS_FILE = resolve(process.cwd(), "..", "..", "test", "visual", "screens.json");

/** Every route the console serves: each page file's folder, as the app router names it. */
function pageRoutes(dir: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Private folders (`_x`, `__tests__`) are not routes in the app router.
      if (!entry.startsWith("_")) routes.push(...pageRoutes(full));
    } else if (entry === "page.tsx") {
      const rel = relative(APP_DIR, dir).split(sep).join("/");
      routes.push(rel === "" ? "/" : `/${rel}`);
    }
  }
  return routes;
}

/** What a route lacks on the list, said as the fix. */
function unlisted(routes: readonly string[], listed: readonly string[]): string[] {
  return routes
    .filter((route) => !listed.includes(route))
    .map(
      (route) =>
        `${route} has no entry in test/visual/screens.json: draw it in the gallery and hold it to an approved drawing, ` +
        "or say why it has none (test/visual/README.md, Adding a screen)",
    );
}

const listed = Object.keys((JSON.parse(readFileSync(SCREENS_FILE, "utf8")) as { console: Record<string, unknown> }).console);

describe("CON-16 every console screen is on the screen list", () => {
  it("finds the app's page files and the list", () => {
    expect(existsSync(APP_DIR)).toBe(true);
    expect(pageRoutes(APP_DIR).length).toBeGreaterThan(40);
    expect(listed.length).toBeGreaterThan(40);
  });

  it("lists every route the console serves", () => {
    expect(unlisted(pageRoutes(APP_DIR), listed)).toEqual([]);
  });

  it("lists no route the console does not serve", () => {
    const routes = pageRoutes(APP_DIR);
    expect(listed.filter((route) => !routes.includes(route))).toEqual([]);
  });

  it("names a new route the list lacks, and says how to add it", () => {
    expect(unlisted(["/settings/audit", "/settings/members"], ["/settings/members"])).toEqual([
      "/settings/audit has no entry in test/visual/screens.json: draw it in the gallery and hold it to an approved drawing, " +
        "or say why it has none (test/visual/README.md, Adding a screen)",
    ]);
  });
});
