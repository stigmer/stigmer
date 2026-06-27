import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { UnifiedDiffView } from "../UnifiedDiffView";

afterEach(cleanup);

describe("UnifiedDiffView", () => {
  it("renders a parseable patch through the DiffViewer table, not a raw dump", () => {
    const patch =
      "--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+# Title\n+body\n";

    const { container } = render(<UnifiedDiffView patch={patch} />);

    // The accessible table is the renderer — not the old raw <pre>.
    expect(container.querySelector("table")).not.toBeNull();
    // Content is present...
    expect(container.textContent).toContain("# Title");
    expect(container.textContent).toContain("body");
    // ...but the preamble never reaches the screen.
    expect(container.textContent).not.toContain("/dev/null");
    expect(container.textContent).not.toContain("+++");
    // A single hunk shows no @@ separator (DiffViewer omits the first header).
    expect(container.textContent).not.toContain("@@");
  });

  it("shows the subtle @@ separator only between hunks of a multi-hunk patch", () => {
    const patch =
      "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n ctx1\n-a\n+A\n@@ -10,2 +10,3 @@\n ctx2\n+added\n ctx3\n";

    const { container } = render(<UnifiedDiffView patch={patch} />);

    expect(container.querySelector("table")).not.toBeNull();
    // The second hunk's header renders as a separator row.
    expect(container.textContent).toContain("@@ -10,2 +10,3 @@");
  });

  it("falls back to a raw <pre> for an unparseable but non-empty patch", () => {
    const { container } = render(<UnifiedDiffView patch="totally not a diff" />);

    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.textContent).toContain("totally not a diff");
  });

  it("forwards className to the rendered container (e.g. a height cap)", () => {
    const patch = "@@ -1 +1 @@\n-a\n+b\n";
    const { container } = render(<UnifiedDiffView patch={patch} className="max-h-80" />);
    expect(container.querySelector(".max-h-80")).not.toBeNull();
  });
});
