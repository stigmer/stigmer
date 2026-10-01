// Accessibility audit (DD-22) — the editor area: open tabs, the file viewer in
// both File and Diff modes, and the mode toggle.
//
// Covers the Session 18 hardening here: `EditorTabs` `role="tablist"`/`tab` with
// `aria-controls`, the single `role="tabpanel"` body, the `FileViewer`
// `role="region"` (Escape-focusable) and its `Diff | File` `ViewerModeToggle`
// radiogroup — each in light + dark against the shipped stylesheet.

import { describe, it, afterEach, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { WorkspaceSurface } from "../../WorkspaceSurface.js";
import {
  EXPLORER_ENTRY,
  OPEN_FILE_PATH,
  fileChangeForOpenFile,
  mockLister,
  mockReader,
} from "./mock-capabilities.js";
import {
  COLOR_MODES,
  auditA11y,
  renderAudited,
  resetWorkspaceAudit,
} from "./harness.js";

const noop = () => {};

const openEditorProps = {
  entries: [EXPLORER_ENTRY],
  lister: mockLister,
  reader: mockReader,
  editors: [{ entryId: EXPLORER_ENTRY.id, path: OPEN_FILE_PATH, preview: false }],
  selectedFile: { entryId: EXPLORER_ENTRY.id, path: OPEN_FILE_PATH },
  view: "files",
  onOpenFile: noop,
  onActivateEditor: noop,
  onPinEditor: noop,
  onCloseEditor: noop,
  onCollapse: noop,
};

afterEach(resetWorkspaceAudit);

describe("WorkspaceSurface a11y — editor tabs + viewer", () => {
  it.each(COLOR_MODES)("open file, File view (%s)", async (mode) => {
    const container = renderAudited(<WorkspaceSurface {...openEditorProps} />, mode);
    await screen.findByRole("region", { name: "File viewer" });
    // Audit the settled surface: the explorer tree loaded AND the file content
    // rendered (not the skeletons) — both sidebar and editor stable.
    await screen.findByText("README.md");
    await waitFor(() =>
      expect(screen.queryByLabelText("Loading file")).toBeNull(),
    );
    await auditA11y(container, `file view · ${mode}`);
  });

  it.each(COLOR_MODES)("open file, Diff view (%s)", async (mode) => {
    const container = renderAudited(
      <WorkspaceSurface {...openEditorProps} change={fileChangeForOpenFile()} />,
      mode,
    );
    // A change makes the viewer diff-default and exposes the Diff|File toggle;
    // inline diff content resolves synchronously (no artifact fetch).
    await screen.findByRole("radio", { name: "Diff" });
    // Also wait for the explorer tree to settle so we audit the stable surface.
    await screen.findByText("README.md");
    await auditA11y(container, `diff view · ${mode}`);
  });
});
