// The workspace panel's audit setup over the shared a11y harness
// (`src/__tests__/helpers/a11y-audit.tsx`, the canonical statement of the
// audit policy and its rationale). Only what is the workspace's own lives
// here: the listing-cache reset between scenarios.

import { resetAudit } from "../../../__tests__/helpers/a11y-audit.js";
import { __clearWorkspaceListingCache } from "../../workspaceListingCache.js";

export { COLOR_MODES, auditA11y, renderAudited } from "../../../__tests__/helpers/a11y-audit.js";
export type { ColorMode } from "../../../__tests__/helpers/a11y-audit.js";

/**
 * Reset cross-test state. The listing cache is module-level (keyed by entry id),
 * so without this a scenario could take a prior scenario's cached listing —
 * masking the truncation banner or leaking a stale tree. Call in `afterEach`.
 */
export function resetWorkspaceAudit(): void {
  resetAudit();
  __clearWorkspaceListingCache();
}
