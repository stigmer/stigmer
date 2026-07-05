// Accessibility audit (DD-22) — WorkspaceEditor (the Config-facet workspace
// entry manager).
//
// Covers the Session 18 hardening here: aria-labeled git inputs and focus rings
// on the editor's buttons. Audits two states — the default action list and the
// manual "add git repository" form — in light + dark against the shipped CSS.

import { describe, it, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { WorkspaceEditor } from "../../WorkspaceEditor.js";
import type { UseWorkspaceEntriesReturn } from "../../useWorkspaceEntries.js";
import {
  COLOR_MODES,
  auditA11y,
  renderAudited,
  resetWorkspaceAudit,
} from "./harness.js";

/** A minimal workspace hook return — rendering only reads `entries`. */
function mockWorkspace(
  entries: UseWorkspaceEntriesReturn["entries"] = [],
): UseWorkspaceEntriesReturn {
  return {
    entries,
    addGitRepo: () => {},
    addLocalPath: () => {},
    remove: () => {},
    clear: () => {},
    clearLocal: () => {},
    toInput: () => [],
    hasEntries: entries.length > 0,
  };
}

const GIT_ENTRY = {
  id: "editor-entry",
  name: "acme/app",
  type: "git" as const,
  gitUrl: "https://github.com/acme/app.git",
  gitBranch: "main",
};

afterEach(resetWorkspaceAudit);

describe("WorkspaceEditor a11y", () => {
  it.each(COLOR_MODES)("default action list with an entry (%s)", async (mode) => {
    const container = renderAudited(
      <WorkspaceEditor workspace={mockWorkspace([GIT_ENTRY])} enableLocal />,
      mode,
    );
    await screen.findByText("Connect GitHub");
    await auditA11y(container, `editor list · ${mode}`);
  });

  it.each(COLOR_MODES)("manual add-git form with labeled inputs (%s)", async (mode) => {
    const container = renderAudited(
      // Empty entries + initialPanel="github" with no connection opens the
      // manual URL/branch form (the labeled git inputs Session 18 hardened).
      <WorkspaceEditor workspace={mockWorkspace()} initialPanel="github" />,
      mode,
    );
    await screen.findByLabelText("Git repository URL");
    await auditA11y(container, `editor git form · ${mode}`);
  });
});
