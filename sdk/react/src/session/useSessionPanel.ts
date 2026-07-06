"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { isTerminalPhase } from "../execution/execution-phases.js";
import type { SelectedThreadItem } from "../internal/store/selection-store.js";
import {
  useWorkspaceEditorsStoreRef,
  type OpenFileOptions,
  type WorkspaceEditorsStore,
} from "../internal/store/index.js";
import { PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH } from "./plan-document.js";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "./artifact-document.js";
import { artifactKey } from "./useSessionArtifacts.js";

/** Options for {@link useSessionPanel}. */
export interface UseSessionPanelOptions {
  /**
   * The display execution's phase, or `null` before any execution exists.
   * A transition between running and terminal resets the user's sticky view
   * pick (mirroring the retired inspector-tab FSM).
   */
  readonly phase: ExecutionPhase | null;
  /**
   * Whether the session has git write-backs. The first arrival auto-surfaces
   * the Changes view — but only while the panel is open; a collapsed panel
   * signals through badges instead of pulling the user out of the chat.
   */
  readonly hasChanges: boolean;
  /**
   * Identity of the session's current plan, or `null` when none exists. Two
   * identity families, supplied by the viewer: `<executionId>:streaming`
   * while the active turn is WRITING a plan (see `findStreamingPlan`), then
   * the published identity (`planDraftKey`) once the artifact exists. A NEW
   * identity — a plan starting to stream, the first published plan, or a
   * refined plan superseding it — auto-opens the plan document tab (see
   * {@link SessionPanelController.openPlanDocument}), expanding a collapsed
   * panel. This deliberately breaks the Changes/Inspect "never open a
   * collapsed panel" convention: a plan is not ambient state, it is the
   * deliverable of the turn the user just requested, and with the thread
   * showing only a compact card there is no other review surface — live or
   * settled. The streaming→published transition is itself a new identity,
   * harmlessly re-firing the (idempotent) open as the tab's content settles.
   * Keyed on plan IDENTITY, not presence, so a refined plan re-surfaces too;
   * the identity present at mount is swallowed (loading a session with an
   * old plan — or mid-stream — never hijacks the layout).
   */
  readonly planKey?: string | null;
  /**
   * The panel's home view — the view it opens on and the one every automatic
   * reset returns to (running⇄terminal transition, selection cleared). Defaults
   * to `"files"` (the Explorer), which suits the session viewer. The launcher
   * passes `"configure"`: pre-session there is no workspace, so the Config
   * facet — carrying the run defaults (harness/model) — is the useful landing
   * view. Auto-switches (Changes/Inspect) and explicit rail picks still
   * take over from here exactly as before.
   *
   * @default "files"
   */
  readonly defaultView?: string;
}

/**
 * State + actions for the unified session panel, shared by every viewer that
 * hosts it (session + launcher) so they behave identically (DD-016).
 *
 * The panel is the one right-side surface: a workspace surface whose activity
 * rail hosts the session facets (see `useSessionRailViews`). It replaces the
 * former two-view model (narrow inspector ⇄ workspace-mode flip): the panel is
 * **collapsed by default** to a top-right chip, and `isOpen` + `view` describe
 * it fully.
 *
 * Owns the {@link WorkspaceEditorsStore} (the open-editor group) and the view
 * FSM ported from the retired inspector tabs: explicit picks are sticky until
 * a meaningful state change (selection cleared, running⇄terminal transition)
 * resets them back to the `defaultView`. Both are decoupled from any store
 * subscription at the owner level: callbacks mutate imperatively so a file
 * open/switch re-renders only the subscribing panel subtree, never the
 * streaming conversation column (DD-009/DD-010, invariant 2).
 */
export interface SessionPanelController {
  /** The open-editor group store; subscribe with `useWorkspaceEditors`. */
  readonly editorsStore: WorkspaceEditorsStore;
  /** Whether the panel is expanded (chat narrow) or collapsed to the chip. */
  readonly isOpen: boolean;
  /** The active rail view id (`"files"`, `"search"`, or an injected facet). */
  readonly view: string;
  /** Expand the panel, restoring the previous view (or Inspect if a thread item is selected). */
  readonly openPanel: () => void;
  /** Collapse the panel to the chip, preserving editors and view. */
  readonly closePanel: () => void;
  /** Explicit view pick from the rail — sticky against auto-switching. */
  readonly setView: (viewId: string) => void;
  /**
   * Open a file as a preview tab and expand the panel. Pass `options.line` to
   * jump to and highlight a specific 1-based line (e.g. a content-search hit) —
   * the file opens in its line-faithful File view scrolled to that line.
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
  /**
   * Close an editor tab. The panel stays open even when the group empties —
   * unlike the retired workspace-mode flip, the panel is more than files.
   */
  readonly closeEditor: (entryId: string, path: string) => void;
  /**
   * Open (or focus) the plan document tab and expand the panel. The tab is
   * **pinned**, never the recyclable preview slot — file browsing must not
   * evict the plan — and it activates, replacing the focused tab: the plan is
   * the deliverable being reviewed. Fired by the thread cards' "Open plan"
   * (the live `PlanStreamingCard` and the settled `PlanArtifactCard`), the
   * Artifacts facet's `plan.md`, and the new-plan auto-open — which triggers
   * both when a plan STARTS STREAMING and when it publishes (see `planKey`).
   */
  readonly openPlanDocument: () => void;
  /**
   * Open (or focus) an artifact as an editor-pane document tab and expand the
   * panel. Uses the PREVIEW slot — like files and content-search hits, casual
   * artifact browsing reuses one tab (single-click), and double-clicking the
   * tab pins it. Distinct from `openPlanDocument`, which pins its single tab: a
   * plan is the turn's deliverable, artifacts are browsable outputs. The
   * artifact's {@link artifactKey} is the tab identity, shared with the
   * `SurfaceVirtualDocument` the viewer builds for the open tab.
   */
  readonly openArtifact: (artifact: ExecutionArtifact) => void;
  /**
   * Report the current thread-item selection. Called from an effect inside the
   * panel subtree (the level that subscribes to the selection store), keeping
   * the owner subscription-free. While the panel is open, a new selection
   * auto-switches to the Inspect view (unless the user picked one explicitly);
   * a collapsed panel deliberately ignores selections — Inspect has no
   * auto-open (it must never pull the user out of the chat).
   */
  readonly notifySelection: (item: SelectedThreadItem | null) => void;
}

/**
 * Create a {@link SessionPanelController} for a viewer instance.
 */
export function useSessionPanel({
  phase,
  hasChanges,
  planKey = null,
  defaultView = "files",
}: UseSessionPanelOptions): SessionPanelController {
  const editorsStore = useWorkspaceEditorsStoreRef();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setViewState] = useState(defaultView);

  // Sticky explicit pick (rail click) — auto-switching yields to it until a
  // meaningful state change resets it. Same semantics as the retired tab FSM.
  const userPickedViewRef = useRef(false);
  // Render-synced mirror so imperative callbacks read the current view without
  // re-binding on every view change.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Last selection reported by the panel subtree; consulted by transitions that
  // fire at the owner level (open, phase change) where selection state is
  // deliberately not subscribed.
  const selectionRef = useRef<SelectedThreadItem | null>(null);

  // Running⇄terminal transition → reset the sticky pick and re-derive the view.
  // Adjust-state-during-render (the established ResizableSplit pattern) so it
  // lands before paint without an effect.
  const [prevPhase, setPrevPhase] = useState(phase);
  if (phase !== prevPhase) {
    const wasTerminal = prevPhase !== null && isTerminalPhase(prevPhase);
    const isNowTerminal = phase !== null && isTerminalPhase(phase);
    setPrevPhase(phase);
    if (wasTerminal !== isNowTerminal) {
      userPickedViewRef.current = false;
      setViewState(selectionRef.current ? "inspect" : defaultView);
    }
  }

  // First write-back arrived → surface Changes, but only in an open panel and
  // never over an explicit pick. Collapsed panels signal via badges alone.
  const [prevHasChanges, setPrevHasChanges] = useState(hasChanges);
  if (hasChanges !== prevHasChanges) {
    setPrevHasChanges(hasChanges);
    if (hasChanges && isOpen && !userPickedViewRef.current) {
      setViewState("changes");
    }
  }

  const openPlanDocument = useCallback(() => {
    editorsStore.openPinned(PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH);
    setIsOpen(true);
  }, [editorsStore]);

  // A new plan arrived (first plan, or a refinement superseding it) → open the
  // plan document tab, expanding a collapsed panel (see the planKey option doc
  // for why this one trigger may open the panel). An effect, NOT the
  // render-adjust idiom the phase/changes triggers use: those set this
  // component's own state, which the idiom permits — this one mutates the
  // external editors store (notifying subscribers), which is illegal during
  // render. The ref (not effect-less prev-state) swallows the identity present
  // at mount: loading a session with an old plan never hijacks the layout.
  const prevPlanKeyRef = useRef(planKey);
  useEffect(() => {
    if (planKey === prevPlanKeyRef.current) return;
    prevPlanKeyRef.current = planKey;
    if (planKey !== null) {
      openPlanDocument();
    }
  }, [planKey, openPlanDocument]);

  const openPanel = useCallback(() => {
    setIsOpen(true);
    // Re-derive the auto view on entry: a selection made while collapsed
    // surfaces as Inspect now (the collapsed panel ignored it by design).
    if (!userPickedViewRef.current && selectionRef.current) {
      setViewState("inspect");
    }
  }, []);

  const closePanel = useCallback(() => setIsOpen(false), []);

  const setView = useCallback((viewId: string) => {
    userPickedViewRef.current = true;
    setViewState(viewId);
  }, []);

  const openFile = useCallback(
    (entryId: string, path: string, options?: OpenFileOptions) => {
      editorsStore.openPreview(entryId, path, options);
      setIsOpen(true);
    },
    [editorsStore],
  );

  const openArtifact = useCallback(
    (artifact: ExecutionArtifact) => {
      editorsStore.openPreview(ARTIFACT_DOCUMENT_ENTRY_ID, artifactKey(artifact));
      setIsOpen(true);
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

  const notifySelection = useCallback(
    (item: SelectedThreadItem | null) => {
      if (item === selectionRef.current) return;
      selectionRef.current = item;
      if (item) {
        if (isOpen && !userPickedViewRef.current) setViewState("inspect");
      } else if (viewRef.current === "inspect") {
        // Selection cleared: leave Inspect (its content is gone) and unstick,
        // returning to the panel's home view.
        userPickedViewRef.current = false;
        setViewState(defaultView);
      }
    },
    [isOpen, defaultView],
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
      openPlanDocument,
      openArtifact,
      notifySelection,
    }),
    [
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
      openPlanDocument,
      openArtifact,
      notifySelection,
    ],
  );
}
