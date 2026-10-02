// Accessibility audit — the container every labelled skeleton renders through.
//
// Pins stigmer/stigmer#1653's class closed: a busy region named by hidden
// text passes the same axe policy the console's e2e page audits apply, in
// both color modes, both as the bare primitive and as a skeleton built on it
// (ThreadSkeleton). The negative control renders a role-less, aria-labelled
// busy container and expects the audit to refuse it, so this suite cannot
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

  it.each(COLOR_MODES)("a skeleton built on it: ThreadSkeleton (%s)", async (mode) => {
    const container = renderAudited(<ThreadSkeleton />, mode, CANVAS);
    expect(screen.getByText("Loading conversation")).toBeTruthy();
    await auditA11y(container, `thread skeleton · ${mode}`);
  });

  it("refuses a role-less, aria-labelled busy container", async () => {
    const container = renderAudited(
      // eslint-disable-next-line stigmer/require-loading-region -- the markup this suite proves the audit refuses
      <div className="stg:space-y-2 stg:px-2" aria-busy="true" aria-label="Loading sessions">
        {placeholders()}
      </div>,
      "light",
      CANVAS,
    );
    await expect(auditA11y(container, "aria-labelled busy div")).rejects.toThrow(/aria-prohibited-attr/);
  });
});
