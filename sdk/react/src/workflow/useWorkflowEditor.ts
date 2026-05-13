"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Diagnostic } from "@codemirror/lint";
import { useWorkflowValidation } from "./useWorkflowValidation";
import { useWorkflowTopology } from "./useWorkflowTopology";
import { useWorkflowSave } from "./useWorkflowSave";
import { useTaskKindRegistryContext } from "./TaskKindRegistryContext";
import { useTaskKindRegistry } from "./useTaskKindRegistry";

/** Options for {@link useWorkflowEditor}. */
export interface UseWorkflowEditorOptions {
  /** Organization slug for the save path. */
  readonly org: string;
}

/** Return value of {@link useWorkflowEditor}. */
export interface UseWorkflowEditorReturn {
  /** Current YAML content in the editor. */
  readonly yaml: string;
  /** Update the YAML content (called by the editor on change). */
  readonly setYaml: (value: string) => void;
  /** CodeMirror-compatible diagnostics from the validation pipeline. */
  readonly diagnostics: readonly Diagnostic[];
  /** `true` when the editor content differs from the initial value. */
  readonly isDirty: boolean;
  /** `true` while a save request is in flight. */
  readonly isSaving: boolean;
  /** Error from the last failed save, or `null` on success. */
  readonly saveError: Error | null;
  /** Persist the current YAML to the server. Returns `true` on success. */
  readonly save: () => Promise<boolean>;
  /** Reset the editor to the initial YAML (discards changes). */
  readonly reset: () => void;
  /** Topology data for the graph preview. */
  readonly topology: ReturnType<typeof useWorkflowTopology>;
  /** Count of error-level diagnostics. */
  readonly errorCount: number;
  /** Count of warning-level diagnostics. */
  readonly warningCount: number;
}

/**
 * Behavior hook that orchestrates the workflow YAML editor experience.
 *
 * Composes the validation pipeline, topology computation, and save logic
 * into a single return value that the `WorkflowEditorView` renders.
 *
 * @param initialYaml - The YAML string to initialize the editor with.
 * @param options - Editor configuration (organization slug).
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export function useWorkflowEditor(
  initialYaml: string,
  options: UseWorkflowEditorOptions,
): UseWorkflowEditorReturn {
  const [yaml, setYaml] = useState(initialYaml);
  const initialRef = useRef(initialYaml);

  const registry = useTaskKindRegistry();
  const { diagnostics } = useWorkflowValidation(yaml, registry);
  const topology = useWorkflowTopology(yaml);
  const { save: applySave, isSaving, error: saveError } = useWorkflowSave(options.org);

  const isDirty = yaml !== initialRef.current;

  const save = useCallback(async (): Promise<boolean> => {
    const success = await applySave(yaml);
    if (success) {
      initialRef.current = yaml;
    }
    return success;
  }, [applySave, yaml]);

  const reset = useCallback(() => {
    setYaml(initialRef.current);
  }, []);

  const errorCount = useMemo(
    () => diagnostics.filter((d) => d.severity === "error").length,
    [diagnostics],
  );

  const warningCount = useMemo(
    () => diagnostics.filter((d) => d.severity === "warning").length,
    [diagnostics],
  );

  return useMemo(
    () => ({
      yaml,
      setYaml,
      diagnostics,
      isDirty,
      isSaving,
      saveError,
      save,
      reset,
      topology,
      errorCount,
      warningCount,
    }),
    [yaml, setYaml, diagnostics, isDirty, isSaving, saveError, save, reset, topology, errorCount, warningCount],
  );
}
