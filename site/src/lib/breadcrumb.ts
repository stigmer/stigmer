import { getBreadcrumbItems, type BreadcrumbItem } from "fumadocs-core/breadcrumb";
import type * as PageTree from "fumadocs-core/page-tree";
import { getSidebarTabs } from "fumadocs-ui/utils/get-sidebar-tabs";

export type { BreadcrumbItem };

/**
 * Fallback root crumb for pages outside any root folder. The main docs tree
 * has no folder node of its own, so — exactly like the hand-written "Docs"
 * tab in `app/docs/layout.tsx` — its label cannot be derived from the tree.
 */
const DOCS_ROOT: BreadcrumbItem = { name: "Docs", url: "/docs" };

/**
 * Computes the breadcrumb trail for a docs page, scoped to the active top tab.
 *
 * Fumadocs' built-in breadcrumb cannot express "root = active tab": with
 * `includeRoot` it keeps root folders in the trail (producing a duplicate,
 * dead "SDK" crumb on every SDK page) and pins the root link to one static
 * URL. This helper instead composes two public APIs:
 *
 * - `getSidebarTabs` — the same utility the layout's tab bar is built from —
 *   supplies the active tab's name and landing URL, so crumbs and tabs share
 *   one source of truth.
 * - `getBreadcrumbItems` without `includeRoot` — root folders reset the trail
 *   by design, yielding clean in-tab crumbs (`React SDK > Core`).
 *
 * Returns `[]` on tab landing pages (`/docs`, `/docs/sdk`, `/docs/cli`): the
 * tab bar and page title already establish context there, so the breadcrumb
 * is hidden. Pages that exist as routes but not as sidebar entries (e.g. the
 * generated task-type pages, see DD-01 §5) have no tree path; they fall back
 * to the root crumb alone, matching their previous rendering.
 */
export function buildBreadcrumbItems(
  tree: PageTree.Root,
  url: string,
): BreadcrumbItem[] {
  const activeTab = getSidebarTabs(tree).find((tab) => tab.urls?.has(url));
  const root: BreadcrumbItem = activeTab
    ? { name: activeTab.title, url: activeTab.url }
    : DOCS_ROOT;

  if (url === root.url) return [];

  const trail = getBreadcrumbItems(url, tree, { includePage: true });
  return [root, ...trail];
}
