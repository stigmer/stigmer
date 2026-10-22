/**
 * The site's static routes, read from disk: each `page.tsx` under `src/app`,
 * at any depth, as its URL path ("/pricing", "/compare/x").
 *
 * Tests that must cover every page walk this list, so a page added later is
 * covered without anyone remembering to add it. The root page, anything
 * under a dynamic segment and the docs are left out: the root serves the
 * layout's own metadata, and the docs and posts are listed from their
 * sources, page by page.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");

export function staticRoutes(dir = APP_DIR, prefix = ""): readonly string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("[") && !name.startsWith("(") && name !== "__tests__")
    .filter((name) => !(prefix === "" && name === "docs"))
    .flatMap((name) => {
      const route = `${prefix}/${name}`;
      const own = fs.existsSync(path.join(dir, name, "page.tsx")) ? [route] : [];
      return [...own, ...staticRoutes(path.join(dir, name), route)];
    });
}
