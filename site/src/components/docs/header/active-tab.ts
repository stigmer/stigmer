import { isTabActive } from "fumadocs-ui/utils/is-active";
import type { Option } from "fumadocs-ui/components/layout/root-toggle";

/**
 * Resolve which docs tab (Docs / SDK / CLI) is active for a pathname.
 *
 * `findLast` mirrors Fumadocs' own tab components (`LayoutTabs`,
 * `RootToggle`): the LAST matching entry wins, which is why the catch-all
 * Docs tab (`/docs` prefix) must stay first in the array — it matches every
 * docs URL and must lose to the more specific SDK/CLI tabs on their own
 * subtrees. Keeping the semantics identical means the header (desktop) and
 * the drawer's RootToggle (mobile) can never disagree about the active tab.
 */
export function selectActiveTab(
  tabs: Option[],
  pathname: string,
): Option | undefined {
  return tabs.findLast((tab) => isTabActive(tab, pathname));
}
