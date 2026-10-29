// Tests for CodeMirrorYamlEditor, the CodeMirror editor YamlEditor loads: it
// shows the YAML it is given, reports a person's edit through onChange,
// takes that edit back from a controlled parent without dispatching it
// again, follows a new value from outside and keeps reporting edits after it,
// switches read-only, and draws the diagnostics it is passed as lint
// markers, clamped to the document's length.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { forEachDiagnostic } from "@codemirror/lint";
import { CodeMirrorYamlEditor } from "../CodeMirrorYamlEditor";
import type { YamlEditorDiagnostic } from "../YamlEditor";

afterEach(cleanup);

/** The editor's CodeMirror view, found from its DOM. */
function viewOf(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-editor");
  if (!(dom instanceof HTMLElement)) throw new Error("no CodeMirror editor rendered");
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error("no view behind the editor's DOM");
  return view;
}

function diagnosticsOf(view: EditorView) {
  const found: { from: number; to: number; message: string }[] = [];
  forEachDiagnostic(view.state, (d, from, to) => found.push({ from, to, message: d.message }));
  return found;
}

describe("CodeMirrorYamlEditor", () => {
  it("shows the value it is given, in the root's classes", () => {
    const { container } = render(<CodeMirrorYamlEditor value={"kind: Agent\n"} className="stg:h-56" />);

    expect(viewOf(container).state.doc.toString()).toBe("kind: Agent\n");
    expect(container.firstElementChild?.className).toContain("stg:h-56");
  });

  it("reports an edit through onChange", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeMirrorYamlEditor value="kind: Agent" onChange={onChange} />);

    const view = viewOf(container);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nname: a" } });

    expect(onChange).toHaveBeenLastCalledWith("kind: Agent\nname: a");
  });

  it("takes its own edit back from a controlled parent without rewriting the document", () => {
    function Controlled() {
      const [value, setValue] = useState("kind: Agent");
      return <CodeMirrorYamlEditor value={value} onChange={setValue} />;
    }
    const { container } = render(<Controlled />);
    const view = viewOf(container);
    const dispatch = vi.spyOn(view, "dispatch");

    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nname: a" } }));

    expect(view.state.doc.toString()).toBe("kind: Agent\nname: a");
    // Only the edit itself: the value coming back is not dispatched again.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("follows a new value from outside, and reports the edits after it", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<CodeMirrorYamlEditor value="kind: Agent" onChange={onChange} />);

    rerender(<CodeMirrorYamlEditor value="kind: Skill" onChange={onChange} />);

    expect(viewOf(container).state.doc.toString()).toBe("kind: Skill");
    const view = viewOf(container);
    view.dispatch({ changes: { from: 0, insert: "# " } });
    expect(onChange).toHaveBeenLastCalledWith("# kind: Skill");
  });

  it("switches read-only with the prop", () => {
    const { container, rerender } = render(<CodeMirrorYamlEditor value="kind: Agent" />);
    expect(viewOf(container).state.facet(EditorState.readOnly)).toBe(false);

    rerender(<CodeMirrorYamlEditor value="kind: Agent" readOnly />);

    expect(viewOf(container).state.facet(EditorState.readOnly)).toBe(true);
  });

  it("draws the diagnostics it is passed, clamped to the document", () => {
    const diagnostics: YamlEditorDiagnostic[] = [
      { from: 0, to: 4, severity: "error", message: "unknown kind" },
      { from: 6, to: 999, severity: "warning", message: "runs past the end" },
    ];
    const { container } = render(<CodeMirrorYamlEditor value="kind: Agent" diagnostics={diagnostics} />);

    expect(diagnosticsOf(viewOf(container))).toEqual([
      { from: 0, to: 4, message: "unknown kind" },
      { from: 6, to: 11, message: "runs past the end" },
    ]);
  });
});
