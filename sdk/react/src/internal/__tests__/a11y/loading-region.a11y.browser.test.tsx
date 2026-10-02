// Accessibility audit — the loading container every skeleton renders through.
//
// Pins stigmer/stigmer#1653's class closed: a busy region named by hidden
// text passes the same axe policy the console's e2e page audits apply, in
// both color modes, both as the bare primitive and as a swept skeleton
// (ThreadSkeleton). The negative control renders the markup the skeletons had
// before the sweep and expects the audit to refuse it, so this suite cannot
// pass by auditing nothing.

import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../../__tests__/helpers/a11y-audit.js";
import { ThreadSkeleton } from "../../../execution/ThreadSkeleton.js";
import { LoadingRegion } from "../../LoadingRegion.js";

const CANVAS = { width: 320, height: 400 } as const;

function placeholders() {
  return Array.from({ length: 3 }, (_, i) => (
    <div key={i} className="stg:h-5 stg:animate-pulse stg:rounded stg:bg-muted" />
  ));
}

afterEach(resetAudit);

describe("LoadingRegion a11y", () => {
  it.each(COLOR_MODES)("a labelled region of placeholders (%s)", async (mode) => {
    const container = renderAudited(
      <LoadingRegion className="stg:space-y-2 stg:px-2" label="Loading sessions">
        {placeholders()}
      </LoadingRegion>,
      mode,
      CANVAS,
    );
    expect(screen.getByText("Loading sessions").closest('[aria-busy="true"]')).not.toBeNull();
    await auditA11y(container, `loading region · ${mode}`);
  });

  it.each(COLOR_MODES)("a swept skeleton: ThreadSkeleton (%s)", async (mode) => {
    const container = renderAudited(<ThreadSkeleton />, mode, CANVAS);
    expect(screen.getByText("Loading conversation")).toBeTruthy();
    await auditA11y(container, `thread skeleton · ${mode}`);
  });

  it("refuses the markup the skeletons had before the sweep", async () => {
    const container = renderAudited(
      // eslint-disable-next-line stigmer/require-loading-region -- the pre-#1653 markup, rendered so the audit is shown to refuse it
      <div className="stg:space-y-2 stg:px-2" aria-busy="true" aria-label="Loading sessions">
        {placeholders()}
      </div>,
      "light",
      CANVAS,
    );
    await expect(auditA11y(container, "pre-sweep skeleton")).rejects.toThrow(/aria-prohibited-attr/);
  });
});
