// The screen list (../screens.json): every route the web console and the
// desktop app serve, each with the gallery scenes that draw it. A screen is
// held to the page by its scenes: at least one is built to a drawing the
// maintainer passed (src/__tests__/screens.test.ts). The apps' tests read
// the same file to prove every route they serve is on it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * One screen: the scenes that draw it, with `pending` naming the open issue
 * while none of them is built to a passed drawing yet (a known gap, as
 * `design/layout-pending.json` lists known layout breaks); or, for a desktop
 * route, the console route whose view it draws (`same`), held by that
 * route's scenes; or why it has no screen of its own (`none`: a redirect, a
 * route that draws nothing), with the route it sends a person to as `same`
 * when there is one.
 */
export type ScreenEntry =
  | { readonly scenes: readonly string[]; readonly pending?: string }
  | { readonly same: string }
  | { readonly none: string; readonly same?: string };

export interface Screens {
  /** The web console's routes, by their `client-apps/web/src/app` path (`/library/agents/[org]/[slug]`). */
  readonly console: Readonly<Record<string, ScreenEntry>>;
  /** The desktop app's routes, by their path in `client-apps/desktop/src/routes.tsx` (`/library/agents/:org/:slug`). */
  readonly desktop: Readonly<Record<string, ScreenEntry>>;
}

export const SCREENS_FILE = fileURLToPath(new URL("../screens.json", import.meta.url));

export function readScreens(): Screens {
  return JSON.parse(readFileSync(SCREENS_FILE, "utf8")) as Screens;
}
