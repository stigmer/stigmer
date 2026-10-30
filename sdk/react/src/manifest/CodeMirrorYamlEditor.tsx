"use client";

import {
  useRef,
  useEffect,
  memo,
} from "react";
import { cn } from "@stigmer/design-tokens";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightSpecialChars } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { lintGutter, type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import type { YamlEditorProps } from "./YamlEditor.js";

/**
 * The CodeMirror 6 editor behind {@link YamlEditor}: syntax highlighting,
 * line numbers, bracket matching, folding, undo/redo and the inline
 * diagnostic markers, themed by the `--stgm-*` tokens. `YamlEditor` loads
 * this module on first render; nothing imports it statically, so an app
 * downloads CodeMirror only when it opens an editor.
 */
export const CodeMirrorYamlEditor = memo(function CodeMirrorYamlEditor({
  value,
  onChange,
  diagnostics,
  readOnly = false,
  className,
  style,
}: YamlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const isInternalUpdate = useRef(false);

  useEffect(() => {
    /* v8 ignore next -- @preserve: effects run after the commit that attaches the ref, so the container is always there */
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
  }, []);

  // Sync external value changes into the editor
  useEffect(() => {
    const view = viewRef.current;
    /* v8 ignore next -- @preserve: the first effect creates the view before this one runs, and the cleanup that clears it runs only on unmount */
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
    /* v8 ignore next -- @preserve: the first effect creates the view before this one runs, and the cleanup that clears it runs only on unmount */
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
    /* v8 ignore next -- @preserve: the first effect creates the view before this one runs, and the cleanup that clears it runs only on unmount */
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
        "stgm-yaml-editor stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-background stg:font-mono stg:text-sm",
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
  { tag: tags.propertyName, color: "var(--stgm-syntax-property)" },
  { tag: tags.tagName, color: "var(--stgm-syntax-tag)" },
  { tag: tags.keyword, color: "var(--stgm-syntax-keyword)", fontWeight: "bold" },
  { tag: tags.string, color: "var(--stgm-syntax-string)" },
  { tag: tags.number, color: "var(--stgm-syntax-number)" },
  { tag: [tags.bool, tags.null], color: "var(--stgm-syntax-bool)" },
  { tag: tags.atom, color: "var(--stgm-syntax-atom)" },
  { tag: tags.comment, color: "var(--stgm-syntax-comment)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--stgm-syntax-meta)" },
  { tag: tags.name, color: "var(--stgm-foreground)" },
  { tag: tags.definition(tags.name), color: "var(--stgm-syntax-property)" },
  { tag: tags.separator, color: "var(--stgm-muted-foreground)" },
  { tag: tags.punctuation, color: "var(--stgm-muted-foreground)" },
]);

// ---------------------------------------------------------------------------
// CodeMirror theme bridge: maps --stgm-* tokens to editor styles
// ---------------------------------------------------------------------------

const stigmerTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--stgm-background)",
    color: "var(--stgm-foreground)",
    fontSize: "var(--stgm-text-sm)",
  },
  ".cm-content": {
    caretColor: "var(--stgm-foreground)",
    fontFamily: "var(--stgm-font-mono)",
    padding: "8px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--stgm-foreground)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--stgm-accent)",
    },
  ".cm-gutters": {
    backgroundColor: "var(--stgm-muted)",
    color: "var(--stgm-muted-foreground)",
    border: "none",
    borderRight: "1px solid var(--stgm-border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--stgm-accent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--stgm-accent) 30%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--stgm-muted)",
    border: "1px solid var(--stgm-border)",
    color: "var(--stgm-muted-foreground)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--stgm-popover)",
    color: "var(--stgm-popover-foreground)",
    border: "1px solid var(--stgm-border)",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--stgm-accent)",
      color: "var(--stgm-accent-foreground)",
    },
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid var(--stgm-destructive)",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid var(--stgm-warning)",
  },
  ".cm-diagnostic-info": {
    borderLeft: "3px solid var(--stgm-primary)",
  },
  ".cm-lint-marker-error": {
    content: "'●'",
    color: "var(--stgm-destructive)",
  },
  ".cm-lint-marker-warning": {
    content: "'●'",
    color: "var(--stgm-warning)",
  },
});
