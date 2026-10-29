// Tests for YamlEditor, the public boundary in front of the CodeMirror
// editor, an optional peer: it says it is loading until the editor's module
// arrives, then renders it with the props it was given; when the module
// cannot load (CodeMirror not installed), it names the packages to install
// instead of throwing; and a failed load is not remembered, so the next
// mount tries again. The CodeMirror module is mocked: these tests are about
// the boundary, not the editor (stigmer#2621).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { YamlEditorProps } from "../YamlEditor";

afterEach(() => {
  cleanup();
  vi.doUnmock("../CodeMirrorYamlEditor");
  vi.resetModules();
});

/** The editor module, loaded fresh with the CodeMirror module mocked by `factory`. */
async function editorWith(factory: () => unknown) {
  vi.resetModules();
  vi.doMock("../CodeMirrorYamlEditor", factory);
  return (await import("../YamlEditor")).YamlEditor;
}

describe("YamlEditor", () => {
  it("says it is loading, then renders the CodeMirror editor with its props", async () => {
    const YamlEditor = await editorWith(() => ({
      CodeMirrorYamlEditor: ({ value, className }: YamlEditorProps) => <pre data-testid="codemirror" className={className}>{value}</pre>,
    }));

    render(<YamlEditor value="kind: Agent" className="stg:h-56" />);

    const loading = screen.getByText("Loading editor…");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.className).toContain("stg:h-56");
    const editor = await screen.findByTestId("codemirror");
    expect(editor.textContent).toBe("kind: Agent");
    expect(editor.className).toBe("stg:h-56");
    expect(screen.queryByText("Loading editor…")).toBeNull();
  });

  it("names the CodeMirror packages to install when the editor cannot load", async () => {
    const YamlEditor = await editorWith(() => {
      throw new Error("Cannot find package '@codemirror/state'");
    });

    render(<YamlEditor value="" className="stg:h-80" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The YAML editor could not load.");
    expect(alert.textContent).toContain(
      "npm install @codemirror/autocomplete @codemirror/commands @codemirror/lang-yaml @codemirror/language @codemirror/lint @codemirror/state @codemirror/view @lezer/highlight",
    );
    expect(alert.className).toContain("stg:h-80");
  });

  it("tries the import again on the next mount after a failed one", async () => {
    let installed = false;
    const YamlEditor = await editorWith(() => {
      if (!installed) throw new Error("Cannot find package '@codemirror/state'");
      return { CodeMirrorYamlEditor: () => <pre data-testid="codemirror" /> };
    });

    const first = render(<YamlEditor value="" />);
    await screen.findByRole("alert");
    first.unmount();

    installed = true;
    render(<YamlEditor value="" />);
    expect(await screen.findByTestId("codemirror")).toBeTruthy();
  });
});
