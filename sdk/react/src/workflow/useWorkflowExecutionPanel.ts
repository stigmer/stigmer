"use client";

// State + actions for the workflow execution viewer's WorkspaceSurface panel.
// Domain: workflow (the lean analog of session/useSessionPanel).

import { useCallback, useMemo, useState } from "react";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  useWorkspaceEditorsStoreRef,
  type OpenFileOptions,
  type WorkspaceEditorsStore,
} from "../internal/store/index.js";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../execution/artifact-document.js";
import {
  FILE_CHANGE_DOCUMENT_ENTRY_ID,
  fileChangeTabPath,
} from "../execution/file-change-document.js";
import {
  AGENT_EXECUTION_DOCUMENT_ENTRY_ID,
  agentExecutionTabPath,
} from "../execution/agent-execution-document.js";
import {
  DIAGNOSIS_DOCUMENT_ENTRY_ID,
  DIAGNOSIS_DOCUMENT_PATH,
} from "./diagnosis-document.js";

/**
 * The identity of a workflow artifact's document tab within the shared
 * artifact-document family — the workflow analog of the session's
 * `artifactKey`. Prefixed with the `Artifact` resource id (immutable,
 * append-only store → a stable, unique identity) and suffixed with the
 * display name because the editor tab's LABEL is the path's basename: a bare
 * id would label the tab `art_01h…` instead of `report.json`.
 */
export function workflowArtifactTabPath(artifact: Artifact): string {
  const id = artifact.metadata?.id ?? "";
  const name =
    artifact.spec?.displayName || artifact.metadata?.name || "Unnamed";
  return `${id}/${name}`;
}

/**
 * State + actions for the workflow execution panel — the SINGLE right-side
 * `WorkspaceSurface` of `WorkflowExecutionViewer` (facets on the rail,
 * documents in the editor area). Collapsed by default (thread-dominant);
 * `isOpen` + `view` describe it fully.
 *
 * Deliberately NOT a shared extraction with `useSessionPanel`: the two
 * controllers share the same primitives (the generic
 * {@link WorkspaceEditorsStore} and the surface itself), but their document
 * families and view semantics are domain-specific.
 */
export interface WorkflowExecutionPanelController {
  /** The open-editor group store; subscribe with `useWorkspaceEditors`. */
  readonly editorsStore: WorkspaceEditorsStore;
  /** Whether the panel is expanded or collapsed to the chip. */
  readonly isOpen: boolean;
  /** The active rail view id (an injected facet — `"artifacts"` today). */
  readonly view: string;
  /** Expand the panel. */
  readonly openPanel: () => void;
  /** Collapse the panel to the chip, preserving editors and view. */
  readonly closePanel: () => void;
  /** Explicit view pick from the rail. */
  readonly setView: (viewId: string) => void;
  /**
   * Open (or focus) the AI-diagnosis conversation as a pinned editor-pane
   * document tab and expand the panel — the singleton analog of the
   * session's `openPlanDocument`. Idempotent: the tab (not an owner-level
   * boolean) is the single source of truth for "diagnosis is active", so
   * re-invoking Diagnose focuses the existing conversation.
   */
  readonly openDiagnosis: () => void;
  /**
   * Open a file as a preview tab and expand the panel. Unused until a
   * workspace-source slice wires a lister, but part of the controller's
   * stable surface so the viewer's editor wiring never changes shape.
   */
  readonly openFile: (
    entryId: string,
    path: string,
    options?: OpenFileOptions,
  ) => void;
  /** Focus an already-open editor tab. */
  readonly activateEditor: (entryId: string, path: string) => void;
  /** Pin an editor tab (clear its preview state). */
  readonly pinEditor: (entryId: string, path: string) => void;
  /** Close an editor tab. The panel stays open when the group empties. */
  readonly closeEditor: (entryId: string, path: string) => void;
  /**
   * Open (or focus) an artifact as an editor-pane document tab and expand the
   * panel. Uses the PREVIEW slot — casual artifact browsing reuses one tab
   * (single-click) and double-clicking pins it, matching the session panel's
   * artifact-tab semantics.
   */
  readonly openArtifact: (artifact: Artifact) => void;
  /**
   * Pin an artifact's tab — the double-click half of the open/activate split.
   * A no-op if the artifact is not open.
   */
  readonly pinArtifact: (artifact: Artifact) => void;
  /**
   * Open (or focus) a file change's diff as an editor-pane document tab and
   * expand the panel. Same preview-slot semantics as {@link openArtifact} —
   * the slot is shared across families, so casually browsing changes and
   * artifacts reuses one tab (true VS Code behavior).
   */
  readonly openFileChange: (change: FileChange) => void;
  /**
   * Pin a file change's diff tab — the double-click half of the
   * open/activate split. A no-op if the change is not open.
   */
  readonly pinFileChange: (change: FileChange) => void;
  /**
   * Open (or focus) a child AgentExecution's transcript as an editor-pane
   * document tab and expand the panel — the S4 in-place expansion. Same
   * preview-slot semantics as {@link openArtifact}: casually stepping
   * through agent calls reuses one tab; pinning keeps one around.
   */
  readonly openAgentExecution: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  /**
   * Pin a child AgentExecution's transcript tab — the double-click half of
   * the open/activate split. A no-op if the transcript is not open.
   */
  readonly pinAgentExecution: (
    childExecutionId: string,
    taskName: string,
  ) => void;
}

/** Options for {@link useWorkflowExecutionPanel}. */
export interface UseWorkflowExecutionPanelOptions {
  /**
   * The panel's home view. Defaults to `"artifacts"` — the one facet this
   * panel carries today (there is no workspace file source yet, so no
   * built-in Explorer to land on).
   * @default "artifacts"
   */
  readonly defaultView?: string;
}

/**
 * Create a {@link WorkflowExecutionPanelController} for a viewer instance.
 */
export function useWorkflowExecutionPanel({
  defaultView = "artifacts",
}: UseWorkflowExecutionPanelOptions = {}): WorkflowExecutionPanelController {
  const editorsStore = useWorkspaceEditorsStoreRef();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setViewState] = useState(defaultView);

  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);

  const setView = useCallback((viewId: string) => setViewState(viewId), []);

  const openDiagnosis = useCallback(() => {
    editorsStore.openPinned(
      DIAGNOSIS_DOCUMENT_ENTRY_ID,
      DIAGNOSIS_DOCUMENT_PATH,
    );
    setIsOpen(true);
  }, [editorsStore]);

  const openFile = useCallback(
    (entryId: string, path: string, options?: OpenFileOptions) => {
      editorsStore.openPreview(entryId, path, options);
      setIsOpen(true);
    },
    [editorsStore],
  );

  const openArtifact = useCallback(
    (artifact: Artifact) => {
      editorsStore.openPreview(
        ARTIFACT_DOCUMENT_ENTRY_ID,
        workflowArtifactTabPath(artifact),
      );
      setIsOpen(true);
    },
    [editorsStore],
  );

  const pinArtifact = useCallback(
    (artifact: Artifact) => {
      editorsStore.pin(
        ARTIFACT_DOCUMENT_ENTRY_ID,
        workflowArtifactTabPath(artifact),
      );
    },
    [editorsStore],
  );

  const openFileChange = useCallback(
    (change: FileChange) => {
      editorsStore.openPreview(
        FILE_CHANGE_DOCUMENT_ENTRY_ID,
        fileChangeTabPath(change),
      );
      setIsOpen(true);
    },
    [editorsStore],
  );

  const pinFileChange = useCallback(
    (change: FileChange) => {
      editorsStore.pin(FILE_CHANGE_DOCUMENT_ENTRY_ID, fileChangeTabPath(change));
    },
    [editorsStore],
  );

  const openAgentExecution = useCallback(
    (childExecutionId: string, taskName: string) => {
      editorsStore.openPreview(
        AGENT_EXECUTION_DOCUMENT_ENTRY_ID,
        agentExecutionTabPath(childExecutionId, taskName),
      );
      setIsOpen(true);
    },
    [editorsStore],
  );

  const pinAgentExecution = useCallback(
    (childExecutionId: string, taskName: string) => {
      editorsStore.pin(
        AGENT_EXECUTION_DOCUMENT_ENTRY_ID,
        agentExecutionTabPath(childExecutionId, taskName),
      );
    },
    [editorsStore],
  );

  const activateEditor = useCallback(
    (entryId: string, path: string) => editorsStore.activate(entryId, path),
    [editorsStore],
  );

  const pinEditor = useCallback(
    (entryId: string, path: string) => editorsStore.pin(entryId, path),
    [editorsStore],
  );

  const closeEditor = useCallback(
    (entryId: string, path: string) => editorsStore.close(entryId, path),
    [editorsStore],
  );

  return useMemo(
    () => ({
      editorsStore,
      isOpen,
      view,
      openPanel,
      closePanel,
      setView,
      openDiagnosis,
      openFile,
      activateEditor,
      pinEditor,
      closeEditor,
      openArtifact,
      pinArtifact,
      openFileChange,
      pinFileChange,
      openAgentExecution,
      pinAgentExecution,
    }),
    [
      editorsStore,
      isOpen,
      view,
      openPanel,
      closePanel,
      setView,
      openDiagnosis,
      openFile,
      activateEditor,
      pinEditor,
      closeEditor,
      openArtifact,
      pinArtifact,
      openFileChange,
      pinFileChange,
      openAgentExecution,
      pinAgentExecution,
    ],
  );
}
