"use client";

import { memo, useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { cn } from "@stigmer/design-tokens";

/**
 * One inline marker in a {@link YamlEditor}: a character range and what is
 * wrong there. CodeMirror's own `Diagnostic` objects fit it, so validation
 * written against `@codemirror/lint` passes its results straight through.
 */
export interface YamlEditorDiagnostic {
  /** Start offset in the document. */
  readonly from: number;
  /** End offset in the document. */
  readonly to: number;
  /** How the marker is drawn. */
  readonly severity: "hint" | "info" | "warning" | "error";
  /** What is wrong, shown on hover. */
  readonly message: string;
  /** Who reported it (a linter's name), shown beside the message. */
  readonly source?: string;
}

/** Props for {@link YamlEditor}. */
export interface YamlEditorProps {
  /** Current YAML content. */
  readonly value: string;
  /** Called when the editor content changes. */
  readonly onChange?: (value: string) => void;
  /** Validation diagnostics to display as inline markers. */
  readonly diagnostics?: readonly YamlEditorDiagnostic[];
  /** Whether the editor is read-only. @default false */
  readonly readOnly?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** Additional inline styles for the root container. */
  readonly style?: CSSProperties;
}

type EditorComponent = ComponentType<YamlEditorProps>;

/**
 * One import of the CodeMirror editor, shared by every mounted editor. A
 * failed import clears it, as `loadMermaid` does: a chunk that failed to
 * load mid-deploy loads on the next mount.
 */
let editorImport: Promise<EditorComponent> | null = null;

/**
 * The editor once it has loaded, so a later mount (a dialog opened again)
 * draws it at once instead of a frame of the loading box.
 */
let loadedEditor: EditorComponent | undefined;

function loadEditor(): Promise<EditorComponent> {
  editorImport ??= import("./CodeMirrorYamlEditor.js").then(
    (module) => (loadedEditor = module.CodeMirrorYamlEditor),
    (error: unknown) => {
      editorImport = null;
      throw error;
    },
  );
  return editorImport;
}

const BOX = "stg:flex stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-border stg:bg-muted stg:text-sm stg:text-muted-foreground";

/**
 * YAML editor, shared by every YAML surface in the SDK (the resource
 * manifest dialogs): syntax highlighting, line numbers, bracket matching,
 * code folding, undo/redo, and inline diagnostic markers driven by
 * external validation (via the `diagnostics` prop). Themed via `--stgm-*`
 * CSS custom properties to respect the host application's design tokens.
 *
 * Built on CodeMirror 6, which the editor loads on first render, so an app
 * that never opens an editor never downloads it. Until it arrives the
 * editor's box says it is loading; if its chunk cannot load (a deploy
 * replaced it, the network dropped), the box says so, and the next mount
 * tries again.
 *
 * @example
 * ```tsx
 * <YamlEditor
 *   value={yaml}
 *   onChange={setYaml}
 *   diagnostics={diagnostics}
 * />
 * ```
 */
export const YamlEditor = memo(function YamlEditor(props: YamlEditorProps) {
  const [state, setState] = useState<{ readonly editor?: EditorComponent; readonly failed?: boolean }>(() => ({ editor: loadedEditor }));

  useEffect(() => {
    if (loadedEditor) return;
    let live = true;
    loadEditor().then(
      (editor) => live && setState({ editor }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, []);

  if (state.editor) {
    const Editor = state.editor;
    return <Editor {...props} />;
  }
  if (state.failed) {
    return (
      <div role="alert" className={cn(BOX, "stg:flex-col stg:gap-1 stg:p-4 stg:text-center", props.className)} style={props.style}>
        <span>The YAML editor could not load.</span>
        <span>Reload the page to try again.</span>
      </div>
    );
  }
  return (
    <div aria-busy="true" className={cn(BOX, props.className)} style={props.style}>
      Loading editor…
    </div>
  );
});
