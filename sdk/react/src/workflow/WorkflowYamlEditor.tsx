"use client";

import {
  useRef,
  useEffect,
  memo,
  type CSSProperties,
} from "react";
import { cn } from "@stigmer/theme";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightSpecialChars } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { lintGutter, type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";

/** Props for {@link WorkflowYamlEditor}. */
export interface WorkflowYamlEditorProps {
  /** Current YAML content. */
  readonly value: string;
  /** Called when the editor content changes. */
  readonly onChange?: (value: string) => void;
  /** Validation diagnostics to display as inline markers. */
  readonly diagnostics?: readonly Diagnostic[];
  /** Whether the editor is read-only. @default false */
  readonly readOnly?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** Additional inline styles for the root container. */
  readonly style?: CSSProperties;
}

/**
 * Schema-aware YAML editor built on CodeMirror 6.
 *
 * Provides syntax highlighting, line numbers, bracket matching,
 * code folding, undo/redo, and inline diagnostic markers driven by
 * external validation (via the `diagnostics` prop).
 *
 * Themed via `--stgm-*` CSS custom properties to respect the host
 * application's design tokens.
 *
 * This is an optional SDK component — it requires CodeMirror peer
 * dependencies which are tree-shaken when not imported (DD-013).
 *
 * @example
 * ```tsx
 * <WorkflowYamlEditor
 *   value={yaml}
 *   onChange={setYaml}
 *   diagnostics={diagnostics}
 * />
 * ```
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export const WorkflowYamlEditor = memo(function WorkflowYamlEditor({
  value,
  onChange,
  diagnostics,
  readOnly = false,
  className,
  style,
}: WorkflowYamlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const isInternalUpdate = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isInternalUpdate.current = true;
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        drawSelection(),
        bracketMatching(),
        indentOnInput(),
        foldGutter(),
        history(),
        yaml(),
        syntaxHighlighting(stigmerHighlightStyle, { fallback: true }),
        autocompletion(),
        lintGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        stigmerTheme,
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }

    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: value,
        },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  // Sync diagnostics into CodeMirror's lint system
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const cmDiags: Diagnostic[] = diagnostics
      ? diagnostics.map((d) => ({
          ...d,
          from: Math.min(d.from, view.state.doc.length),
          to: Math.min(d.to, view.state.doc.length),
        }))
      : [];

    view.dispatch(setDiagnostics(view.state, cmDiags));
  }, [diagnostics]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "stgm-yaml-editor overflow-auto rounded-md border border-border bg-background font-mono text-sm",
        className,
      )}
      style={style}
    />
  );
});

// ---------------------------------------------------------------------------
// Syntax highlighting: maps lezer tags to --stgm-syntax-* CSS variables
// ---------------------------------------------------------------------------

const stigmerHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--stgm-syntax-property, #0550ae)" },
  { tag: tags.tagName, color: "var(--stgm-syntax-tag, #cf222e)" },
  { tag: tags.keyword, color: "var(--stgm-syntax-keyword, #8250df)", fontWeight: "bold" },
  { tag: tags.string, color: "var(--stgm-syntax-string, #0a3069)" },
  { tag: tags.number, color: "var(--stgm-syntax-number, #953800)" },
  { tag: [tags.bool, tags.null], color: "var(--stgm-syntax-bool, #8250df)" },
  { tag: tags.atom, color: "var(--stgm-syntax-atom, #cf222e)" },
  { tag: tags.comment, color: "var(--stgm-syntax-comment, #6e7781)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--stgm-syntax-meta, #8250df)" },
  { tag: tags.name, color: "var(--stgm-foreground, #1a1a2e)" },
  { tag: tags.definition(tags.name), color: "var(--stgm-syntax-property, #0550ae)" },
  { tag: tags.separator, color: "var(--stgm-muted-foreground, #737373)" },
  { tag: tags.punctuation, color: "var(--stgm-muted-foreground, #737373)" },
]);

// ---------------------------------------------------------------------------
// CodeMirror theme bridge: maps --stgm-* tokens to editor styles
// ---------------------------------------------------------------------------

const stigmerTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--stgm-background, #fff)",
    color: "var(--stgm-foreground, #1a1a2e)",
    fontSize: "13px",
  },
  ".cm-content": {
    caretColor: "var(--stgm-foreground, #1a1a2e)",
    fontFamily: "var(--stgm-font-mono, ui-monospace, monospace)",
    padding: "8px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--stgm-foreground, #1a1a2e)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--stgm-accent, #e0e7ff)",
    },
  ".cm-gutters": {
    backgroundColor: "var(--stgm-muted, #f5f5f5)",
    color: "var(--stgm-muted-foreground, #737373)",
    border: "none",
    borderRight: "1px solid var(--stgm-border, #e5e5e5)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--stgm-accent, #e0e7ff)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--stgm-accent, #e0e7ff) 30%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--stgm-muted, #f5f5f5)",
    border: "1px solid var(--stgm-border, #e5e5e5)",
    color: "var(--stgm-muted-foreground, #737373)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--stgm-popover, #fff)",
    color: "var(--stgm-popover-foreground, #1a1a2e)",
    border: "1px solid var(--stgm-border, #e5e5e5)",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--stgm-accent, #e0e7ff)",
      color: "var(--stgm-accent-foreground, #1a1a2e)",
    },
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid var(--stgm-destructive, #ef4444)",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid var(--stgm-warning, #f59e0b)",
  },
  ".cm-diagnostic-info": {
    borderLeft: "3px solid var(--stgm-primary, #6366f1)",
  },
  ".cm-lint-marker-error": {
    content: "'●'",
    color: "var(--stgm-destructive, #ef4444)",
  },
  ".cm-lint-marker-warning": {
    content: "'●'",
    color: "var(--stgm-warning, #f59e0b)",
  },
});
