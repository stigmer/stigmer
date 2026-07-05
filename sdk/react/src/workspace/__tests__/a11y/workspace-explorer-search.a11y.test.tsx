// Accessibility audit (DD-22) — the explorer tree and both search surfaces.
//
// Covers the Session 18 hardening for these surfaces: file-tree `role="tree"` +
// `aria-level` + `aria-hidden` glyphs, the neutral truncation banner + Retry
// focus ring, the search `role="status"` live region, the combobox/listbox
// results, and the `Name | Text` search-mode radiogroup — each in light + dark
// against the shipped stylesheet.

import { describe, it, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { WorkspaceSurface } from "../../WorkspaceSurface.js";
import {
  EXPLORER_ENTRY,
  TRUNCATED_ENTRY,
  mockLister,
  mockReader,
  mockSearcher,
} from "./mock-capabilities.js";
import {
  COLOR_MODES,
  auditA11y,
  renderAudited,
  resetWorkspaceAudit,
} from "./harness.js";

const noop = () => {};

/** The controlled props every WorkspaceSurface render needs, minus the ones a
 *  given scenario varies (entries/lister/searcher/view). */
const baseProps = {
  reader: mockReader,
  editors: [],
  selectedFile: null,
  onOpenFile: noop,
  onActivateEditor: noop,
  onPinEditor: noop,
  onCloseEditor: noop,
  onCollapse: noop,
};

afterEach(resetWorkspaceAudit);

describe("WorkspaceSurface a11y — explorer + search", () => {
  it.each(COLOR_MODES)("explorer tree, populated listing (%s)", async (mode) => {
    const container = renderAudited(
      <WorkspaceSurface
        entries={[EXPLORER_ENTRY]}
        lister={mockLister}
        view="files"
        {...baseProps}
      />,
      mode,
    );
    // The first root auto-expands; wait for a top-level file before auditing so
    // axe sees the loaded tree, not the loading state.
    await screen.findByText("README.md");
    await auditA11y(container, `explorer tree · ${mode}`);
  });

  it.each(COLOR_MODES)("explorer truncation banner (%s)", async (mode) => {
    const container = renderAudited(
      <WorkspaceSurface
        entries={[TRUNCATED_ENTRY]}
        lister={mockLister}
        view="files"
        {...baseProps}
      />,
      mode,
    );
    await screen.findByText(/Showing a partial listing/i);
    await auditA11y(container, `explorer truncation · ${mode}`);
  });

  it.each(COLOR_MODES)("filename search with results (%s)", async (mode) => {
    const container = renderAudited(
      <WorkspaceSurface
        entries={[EXPLORER_ENTRY]}
        lister={mockLister}
        searcher={mockSearcher}
        view="search"
        {...baseProps}
      />,
      mode,
    );
    const input = await screen.findByRole("combobox", {
      name: "Search workspace files by name",
    });
    fireEvent.change(input, { target: { value: "index" } });
    await screen.findByRole("listbox", { name: "Search results" });
    await auditA11y(container, `filename search · ${mode}`);
  });

  it.each(COLOR_MODES)("content (text) search with results (%s)", async (mode) => {
    const container = renderAudited(
      <WorkspaceSurface
        entries={[EXPLORER_ENTRY]}
        lister={mockLister}
        searcher={mockSearcher}
        view="search"
        {...baseProps}
      />,
      mode,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Text" }));
    const input = await screen.findByRole("combobox", {
      name: "Search text in workspace files",
    });
    fireEvent.change(input, { target: { value: "greet" } });
    await screen.findByRole("listbox", { name: "Search results" });
    await auditA11y(container, `content search · ${mode}`);
  });
});
