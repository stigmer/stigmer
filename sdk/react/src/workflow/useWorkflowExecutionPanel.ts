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
 * State + actions for the workflow execution panel — the additive,
 * toggleable `WorkspaceSurface` on the right of `WorkflowExecutionViewer`.
 * Collapsed by default (graph-dominant); `isOpen` + `view` describe it fully.
 *
 * Deliberately NOT a shared extraction with `useSessionPanel`: the session
 * controller's FSM (phase-driven view resets, plan auto-open,
 * Inspect-on-selection) is session-specific, and this controller will grow
 * its own auto-switch semantics as later parity slices land (Usage/Changes/
 * agent-call). They share the primitives instead — the generic
 * {@link WorkspaceEditorsStore} and the surface itself.
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
  const [view, setView] = useState(defaultView);

  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);

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
      openFile,
      activateEditor,
      pinEditor,
      closeEditor,
      openArtifact,
      pinArtifact,
      openFileChange,
      pinFileChange,
    }),
    [
      editorsStore,
      isOpen,
      view,
      openPanel,
      closePanel,
      openFile,
      activateEditor,
      pinEditor,
      closeEditor,
      openArtifact,
      pinArtifact,
      openFileChange,
      pinFileChange,
    ],
  );
}
