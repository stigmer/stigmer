/**
 * Whether the site serves a path: the one answer the tests ask of every
 * internal link, on a page or in the header and footer menus.
 *
 * Read from disk like `static-routes.ts`, so a route, docs page or post
 * added later is covered without a list to keep. A path the redirect file
 * moves is never served, even when its old page still exists: a link to it
 * costs the reader a redirect, and the homepage once linked four Getting
 * Started pages that only redirects still answered. The anchor and query are
 * dropped first; a docs path is served when its `.mdx` or `index.mdx`
 * exists, a post when its `.mdx` exists, a shown picture's file when the
 * visual suite's list names it (the build writes each one at every density,
 * scripts/generate-screens.ts), and anything else when it is one of the
 * static routes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SCREEN_DENSITIES, SHOWN, screenPath } from "@/lib/screens";
import { staticRoutes } from "./static-routes";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, "../../../docs");
const BLOG = path.resolve(HERE, "../../../blog");
const REDIRECTS = path.resolve(HERE, "../../public/_redirects");

/** The paths the redirect file sends elsewhere. */
const MOVED: ReadonlySet<string> = new Set(
  fs
    .readFileSync(REDIRECTS, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("/"))
    .map((line) => line.split(/\s+/)[0]),
);

const ROUTES: ReadonlySet<string> = new Set(staticRoutes());

/** Every file the build writes for the shown pictures. */
const SCREENS: ReadonlySet<string> = new Set(
  SHOWN.flatMap((shown) => SCREEN_DENSITIES.map((density) => screenPath(shown.name, density))),
);

function docsPageExists(page: string): boolean {
  return (
    fs.existsSync(path.join(DOCS, `${page}.mdx`)) ||
    fs.existsSync(path.join(DOCS, page, "index.mdx"))
  );
}

export function servedPath(href: string): boolean {
  const target = href.split(/[#?]/)[0];
  if (MOVED.has(target)) return false;
  if (target === "/") return true;
  if (target === "/docs") return docsPageExists("");
  if (target.startsWith("/docs/")) return docsPageExists(target.slice("/docs/".length));
  if (target.startsWith("/blog/")) {
    return fs.existsSync(path.join(BLOG, `${target.slice("/blog/".length)}.mdx`));
  }
  return ROUTES.has(target) || SCREENS.has(target);
}
