"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { isTerminalPhase } from "../execution/execution-phases.js";
import {
  useWorkspaceEditorsStoreRef,
  type OpenFileOptions,
  type WorkspaceEditorsStore,
} from "../internal/store/index.js";
import { PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH } from "./plan-document.js";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../execution/artifact-document.js";
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
   * view. Auto-switches (Changes) and explicit rail picks still take over
   * from here exactly as before.
   *
   * @default "files"
   */
  readonly defaultView?: string;
  /**
   * Controlled open state. When provided, the host owns whether the panel is
   * expanded: internal open intents (the chip toggle, a file/artifact/plan
   * open, plan auto-open) no longer flip state themselves — they surface
   * through {@link UseSessionPanelOptions.onOpenChange} and the panel follows
   * this value. Leave `undefined` for the self-managing default.
   */
  readonly open?: boolean;
  /**
   * Initial open state in uncontrolled mode. Ignored when
   * {@link UseSessionPanelOptions.open} is provided.
   *
   * @default false
   */
  readonly defaultOpen?: boolean;
  /**
   * Called on every effective open/close transition — in BOTH modes, unlike
   * `useDetailTabs`'s DD-T05A-001 convention of swallowing the callback when
   * uncontrolled. The difference is principled, not stylistic: tabs change
   * only through user clicks, so an uncontrolled host loses nothing by not
   * hearing about them — but this panel opens ITSELF (`openFile`,
   * `openArtifact`, `openPlanDocument`, and the plan-key auto-open all expand
   * a collapsed panel), and an embedding host that must react to those
   * moments (widen a dock, make room for a streaming plan) has no other seam.
   * Passing only this callback observes the panel without controlling it.
   *
   * In controlled mode this fires once per open/close REQUEST (the host may
   * decline by not updating `open` — a later identical request re-fires); in
   * uncontrolled mode it fires once per actual transition.
   */
  readonly onOpenChange?: (open: boolean) => void;
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
 * a meaningful state change (the running⇄terminal transition) resets them
 * back to the `defaultView`. Both are decoupled from any store
 * subscription at the owner level: callbacks mutate imperatively so a file
 * open/switch re-renders only the subscribing panel subtree, never the
 * streaming conversation column (DD-009/DD-010, invariant 2).
 */
export interface SessionPanelController {
  /** The open-editor group store; subscribe with `useWorkspaceEditors`. */
  readonly editorsStore: WorkspaceEditorsStore;
  /**
   * Whether the panel is expanded (chat narrow) or collapsed to the chip.
   * In controlled mode ({@link UseSessionPanelOptions.open}) this mirrors
   * the host's value.
   */
  readonly isOpen: boolean;
  /** The active rail view id (`"files"`, `"search"`, or an injected facet). */
  readonly view: string;
  /** Expand the panel, restoring the previous view. */
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
   * Pin an artifact's tab (clear its preview state) — the double-click half of
   * the open/activate split, the encapsulated sibling of {@link openArtifact}.
   * Delegates to the editors store's generic `pin`, exactly as the file tree
   * pins via `pinEditor`: the leading single-click of the double-click has
   * already opened the preview tab, so this promotes it to a persistent tab. A
   * no-op if the artifact is not open.
   */
  readonly pinArtifact: (artifact: ExecutionArtifact) => void;
}

/**
 * Create a {@link SessionPanelController} for a viewer instance.
 */
export function useSessionPanel({
  phase,
  hasChanges,
  planKey = null,
  defaultView = "files",
  open,
  defaultOpen = false,
  onOpenChange,
}: UseSessionPanelOptions): SessionPanelController {
  const editorsStore = useWorkspaceEditorsStoreRef();

  // Uncontrolled-by-default / controlled-when-`open`-is-provided (React's own
  // value/defaultValue convention — presence of the value prop decides, so an
  // observe-only host can pass just `onOpenChange`). Everything below reads
  // the EFFECTIVE value: the render-adjust triggers (first write-back) and
  // the returned controller must agree with the host's state, never a stale
  // internal one.
  const isControlled = open !== undefined;
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const isOpen = isControlled ? open : internalIsOpen;

  // Latest-ref idiom (see YamlEditor's onChangeRef): the host's callback and
  // the mode/value mirrors live in refs so `requestOpenChange` — and every
  // action callback built on it — stays referentially stable regardless of
  // how the host authored `onOpenChange` (DD-010: an inline lambda must not
  // churn the memoized controller and re-render the panel subtree).
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  // The single seam every open/close intent routes through — the chip
  // toggle, file/artifact/plan opens, the surface's collapse affordance, and
  // the plan-key auto-open. Uncontrolled: apply + notify (the ref is updated
  // eagerly so two same-tick intents produce one notification). Controlled:
  // notify only — the host owns the state, and the panel follows the `open`
  // prop; the ref is NOT updated, so a declined request stays re-fireable.
  const requestOpenChange = useCallback((next: boolean) => {
    if (isOpenRef.current === next) return;
    if (!isControlledRef.current) {
      isOpenRef.current = next;
      setInternalIsOpen(next);
    }
    onOpenChangeRef.current?.(next);
  }, []);

  const [view, setViewState] = useState(defaultView);

  // Sticky explicit pick (rail click) — auto-switching yields to it until a
  // meaningful state change resets it. Same semantics as the retired tab FSM.
  const userPickedViewRef = useRef(false);

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
      setViewState(defaultView);
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
    requestOpenChange(true);
  }, [editorsStore, requestOpenChange]);

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

  const openPanel = useCallback(
    () => requestOpenChange(true),
    [requestOpenChange],
  );

  const closePanel = useCallback(
    () => requestOpenChange(false),
    [requestOpenChange],
  );

  const setView = useCallback((viewId: string) => {
    userPickedViewRef.current = true;
    setViewState(viewId);
  }, []);

  const openFile = useCallback(
    (entryId: string, path: string, options?: OpenFileOptions) => {
      editorsStore.openPreview(entryId, path, options);
      requestOpenChange(true);
    },
    [editorsStore, requestOpenChange],
  );

  const openArtifact = useCallback(
    (artifact: ExecutionArtifact) => {
      editorsStore.openPreview(ARTIFACT_DOCUMENT_ENTRY_ID, artifactKey(artifact));
      requestOpenChange(true);
    },
    [editorsStore, requestOpenChange],
  );

  const pinArtifact = useCallback(
    (artifact: ExecutionArtifact) => {
      editorsStore.pin(ARTIFACT_DOCUMENT_ENTRY_ID, artifactKey(artifact));
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
      openPlanDocument,
      openArtifact,
      pinArtifact,
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
      pinArtifact,
    ],
  );
}
