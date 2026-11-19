// Accessibility audit — contrast blocks. The kit's audit fails a state whose
// readable text sits below WCAG AA, in either mode: a secondary line in the
// readable muted tone passes on the page in light and dark, and the same
// line in the subtle tone, a 3:1 tone for marks, fails in dark. Without this
// pin the rule could drift back to advisory and the subtle tone back onto
// words (stigmer/stigmer#3064) with every audit still green.

import { afterEach, describe, expect, it } from "vitest";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "./helpers/a11y-audit.js";

afterEach(resetAudit);

describe("the audit's contrast rule", () => {
  it.each(COLOR_MODES)("passes a secondary line in the readable muted tone (%s)", async (mode) => {
    const container = renderAudited(<p className="stg:text-xs stg:text-muted-foreground">Judge: not graded</p>, mode);
    await auditA11y(container, `muted line · ${mode}`);
  });

  it("fails a readable line set in the subtle tone in dark", async () => {
    const container = renderAudited(<p className="stg:text-xs stg:text-muted-foreground-subtle">Judge: not graded</p>, "dark");
    await expect(auditA11y(container, "subtle line · dark")).rejects.toThrow(/color-contrast/);
  });
});
