"use client";

// The session inspector's region: today's workspace surface (the explorer,
// editor tabs, search, Changes, Files, the plan document) for a builder,
// moved whole out of SessionViewer so a viewer with no inspector never
// imports it. It reads everything the conversation knows through the scope
// SessionViewer provides (SessionInspectorContext); the host's
// SessionInspector element adds what only the inspector reads (the local
// workspace readers).

import { useCallback, useMemo } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { WorkspaceFileLister } from "../../workspace/WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "../../workspace/WorkspaceFileReader.js";
import type { WorkspaceContentSearcher } from "../../workspace/WorkspaceContentSearcher.js";
import { WorkspaceSurface, type SurfaceVirtualDocument } from "../../workspace/WorkspaceSurface.js";
import type { ApplyResourceResult } from "../../library/useApplyResource.js";
import { useWorkspaceEditors, isVirtualEntryId } from "../../internal/store/index.js";
import { isTerminalPhase } from "../../run/run-phases.js";
import { findPlanFile, type SessionPlan } from "../../library/detect-plan-file.js";
import type { useSessionPageFlow } from "../useSessionPageFlow.js";
import { useOpenFileChange } from "../useOpenFileChange.js";
import { planDraftKey, type PlanDraftController } from "../usePlanDraft.js";
import { PlanEditor } from "../PlanEditor.js";
import { PlanStreamingDocument } from "../PlanStreamingDocument.js";
import { PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH } from "../plan-document.js";
import { FILE_DOCUMENT_ENTRY_ID } from "../../run/file-document.js";
import { FileDocument } from "../../run/FileDocument.js";
import { useSessionRailViews } from "../useSessionRailViews.js";
import type { SessionPanelController } from "../useSessionPanel.js";
import { useWorkspaceReadRefs } from "../useWorkspaceReadRefs.js";
import { outputKey, type SessionOutputEntry } from "../useSessionOutputs.js";
import { givenKey, type SessionGivenEntry } from "../useSessionGivenFiles.js";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

/**
 * A plan the active run is writing right now, resolved by the viewer so the
 * plan tab can render it live: `executionId` keys the document (a new
 * turn's stream resets the tab's view state) and forms the
 * `<executionId>:streaming` identity the plan tab's auto-open follows.
 */
export interface SessionStreamingPlan {
  /** ID of the run writing the plan. */
  readonly executionId: string;
  /** The live plan text (fence-stripped display projection). */
  readonly displayText: string;
}

/** What the inspector region reads: the viewer's scope, and the host's workspace readers. */
export interface SessionInspectorRegionProps extends SessionInspectorScope, SessionInspectorReaders {}

/** What only the host's inspector element carries: reading a local workspace. */
export interface SessionInspectorReaders {
  /** Lists a local workspace's files (desktop); the remote lister otherwise. */
  readonly workspaceFileLister?: WorkspaceFileLister;
  /** Reads a local workspace's file contents (desktop). */
  readonly workspaceFileReader?: WorkspaceFileReader;
  /** Searches a local workspace's contents (desktop). */
  readonly workspaceContentSearcher?: WorkspaceContentSearcher;
}

/** @internal What SessionViewer hands its inspector: the conversation as the panel reads it. */
export interface SessionInspectorScope {
  readonly flow: ReturnType<typeof useSessionPageFlow>;
  readonly org: string;
  /**
   * The panel controller owned by `SessionViewer`. Its editor store is
   * subscribed here (not at `SessionViewer`) so opening/switching files
   * re-renders only this region, never the conversation column.
   */
  readonly panel: SessionPanelController;
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Implement a plan (plan tab primary + Files preview action). */
  readonly onImplementPlan?: () => void;
  readonly implementPlanDisabled?: boolean;
  /** The session's latest plan — the plan tab's editable content. */
  readonly sessionPlan?: SessionPlan;
  /** The conversation's Files, newest first — a superseded plan's File is found here. */
  readonly sessionFiles: readonly StigmerFile[];
  /** What the agent saved, one entry per output path (the Files facet and its tabs). */
  readonly sessionOutputs: readonly SessionOutputEntry[];
  /** What was given to the conversation (the Files facet and its tabs). */
  readonly sessionGiven: readonly SessionGivenEntry[];
  /** Re-read the conversation's Files (the Files facet opened, or a File was deleted). */
  readonly onFilesShown: () => void;
  /**
   * The plan the active turn is writing right now. While present it OWNS the
   * plan tab: the tab renders the live document (`PlanStreamingDocument`)
   * instead of a published plan — the in-flight plan is the newest
   * deliverable, and the snap-back in `SessionViewer` has already cleared any
   * historical selection when this identity appeared.
   */
  readonly streamingPlan?: SessionStreamingPlan;
  /** Viewer-owned plan draft (survives panel collapse and view switches). */
  readonly planDraft: PlanDraftController;
  /**
   * Which plan the plan document tab shows: `null` for the latest (editable),
   * or a run id whose historical plan renders read-only.
   */
  readonly openPlanExecutionId: string | null;
  /** Opens a plan in the plan tab (routed to the Files facet's plan.md). */
  readonly onOpenPlan: (executionId: string) => void;
  /** Opens a File as an editor-pane document by its document key (routed to the Files facet). */
  readonly onOpenFileDocument: (documentKey: string) => void;
  /** Pins a File's document tab — the double-click half of the open/pin split. */
  readonly onActivateFileDocument: (documentKey: string) => void;
  readonly enableLocal: boolean;
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
}

/** The inspector region (module header). */
export function SessionInspectorRegion({
  flow,
  org,
  panel,
  onApplied,
  onImplementPlan,
  implementPlanDisabled,
  sessionPlan,
  sessionFiles,
  sessionOutputs,
  sessionGiven,
  onFilesShown,
  streamingPlan,
  planDraft,
  openPlanExecutionId,
  onOpenPlan,
  onOpenFileDocument,
  onActivateFileDocument,
  enableLocal,
  onBrowseLocalFolder,
  workspaceFileLister,
  workspaceFileReader,
  workspaceContentSearcher,
}: SessionInspectorRegionProps) {
  const { editors, activeKey, activeFile, reveal } = useWorkspaceEditors(
    panel.editorsStore,
  );
  // Honor a pending jump-to-line reveal only while it targets the active editor
  // (an EditorReveal is structurally a RevealTarget). Switching tabs changes
  // activeKey, so a stale reveal for another tab is naturally ignored.
  const activeReveal =
    reveal && reveal.key === activeKey ? reveal : undefined;

  // Correlate the active file with its session change for diff-as-default
  // (parity with the transcript's rendering of the same change). A
  // virtual document (the plan tab) is not a workspace file — pass `null` so
  // the hook's no-file guard skips the net-change fold entirely, rather than
  // relying on the correlation harmlessly missing the sentinel id.
  const openFileChange = useOpenFileChange(
    activeFile && !isVirtualEntryId(activeFile.entryId) ? activeFile : null,
    flow.allRuns,
    flow.workspace.entries,
    flow.sandboxWorkspaceRoot,
  );

  // Resolve WHICH plan the plan document tab shows: the latest (editable,
  // buildable, draft-backed) unless a historical run id was opened —
  // that plan renders read-only. A stale id (run gone, or its plan
  // File missing) degrades to the latest rather than an empty tab.
  const openPlan = useMemo<SessionPlan | undefined>(() => {
    if (
      openPlanExecutionId === null ||
      openPlanExecutionId === sessionPlan?.runId
    ) {
      return sessionPlan;
    }
    const execution = flow.allRuns.find(
      (e) => e.metadata?.id === openPlanExecutionId,
    );
    const file = findPlanFile(sessionFiles, execution);
    return file ? { runId: openPlanExecutionId, file } : sessionPlan;
  }, [openPlanExecutionId, sessionPlan, sessionFiles, flow.allRuns]);

  // The plan document tab (SurfaceVirtualDocument): the panel's editor-area
  // rendering of the session's plan. Three states, in precedence order:
  // a STREAMING plan owns the tab (live document, no actions); otherwise the
  // resolved `openPlan` renders in the editor (keyed by plan identity so
  // switching plans resets view state cleanly); otherwise an honest empty
  // notice — reachable only when a streaming plan auto-opened the
  // tab and its turn then ended without publishing, with no earlier plan to
  // fall back to.
  const openPlanIsLatest = openPlan?.runId === sessionPlan?.runId;
  const planVirtualDocument = useMemo<SurfaceVirtualDocument>(() => {
    return {
      entryId: PLAN_DOCUMENT_ENTRY_ID,
      path: PLAN_DOCUMENT_PATH,
      content: streamingPlan ? (
        <PlanStreamingDocument
          key={`streaming-${streamingPlan.executionId}`}
          displayText={streamingPlan.displayText}
        />
      ) : openPlan ? (
        <PlanEditor
          key={planDraftKey(openPlan)}
          plan={openPlan}
          draft={openPlanIsLatest ? planDraft : undefined}
          onBuildFromPlan={openPlanIsLatest ? onImplementPlan : undefined}
          buildDisabled={implementPlanDisabled}
          readOnly={!openPlanIsLatest}
        />
      ) : (
        <PlanUnavailableNotice />
      ),
    };
  }, [
    streamingPlan,
    openPlan,
    openPlanIsLatest,
    planDraft,
    onImplementPlan,
    implementPlanDisabled,
  ]);

  // The open File document tabs (the File virtual-document FAMILY).
  // Built in a SEPARATE memo from the plan doc so File-tab churn never
  // recreates the plan doc (and vice versa). Bounded to what is actually open:
  // one document per editor whose entry id is the File family's, resolved
  // back to its File by the same document key used to open it (`outputKey`
  // for what the agent saved, `givenKey` for what was given; the two cannot
  // alias). Only the ACTIVE doc's `content` is mounted by the surface, so
  // building these elements is cheap; keying on the File's id remounts a
  // tab whose path a later turn saved again. A tab whose File no longer
  // exists degrades to an honest notice rather than vanishing.
  const fileByKey = useMemo(() => {
    const byKey = new Map<string, { readonly file: StigmerFile; readonly isTerminal: boolean }>();
    for (const entry of sessionOutputs) byKey.set(outputKey(entry.file), entry);
    for (const entry of sessionGiven) byKey.set(givenKey(entry), { file: entry.file, isTerminal: true });
    return byKey;
  }, [sessionOutputs, sessionGiven]);
  const closeEditor = panel.closeEditor;
  const fileVirtualDocuments = useMemo<readonly SurfaceVirtualDocument[]>(() => {
    return editors
      .filter((editor) => editor.entryId === FILE_DOCUMENT_ENTRY_ID)
      .map((editor) => {
        const entry = fileByKey.get(editor.path);
        return {
          entryId: FILE_DOCUMENT_ENTRY_ID,
          path: editor.path,
          content: entry ? (
            <FileDocument
              key={entry.file.metadata?.id || editor.path}
              file={entry.file}
              org={org}
              isTerminal={entry.isTerminal}
              onApplied={onApplied}
              onDeleted={() => {
                closeEditor(FILE_DOCUMENT_ENTRY_ID, editor.path);
                onFilesShown();
              }}
            />
          ) : (
            <FileUnavailableNotice />
          ),
        };
      });
  }, [editors, fileByKey, org, onApplied, closeEditor, onFilesShown]);

  const virtualDocuments = useMemo<readonly SurfaceVirtualDocument[]>(
    () => [planVirtualDocument, ...fileVirtualDocuments],
    [planVirtualDocument, fileVirtualDocuments],
  );

  // Cloud sessions with a git workspace push approved changes back to a
  // branch/PR, so the Changes facet is offered from the start with an honest
  // pre-push state. Deliberately NOT for local sessions: local mode edits the
  // user's own working tree and never writes back (the runner configures no
  // push credentials there) — promising a PR would be a lie.
  const expectsWriteBack =
    flow.executionTarget === "cloud" &&
    flow.workspace.entries.some((entry) => entry.type === "git");
  const displayPhase =
    flow.displayRun?.status?.phase ??
    RunPhase.RUN_PHASE_UNSPECIFIED;

  // The session facets (Config / Changes / Files / Usage) as
  // injected rail views — the full inspector feature set inside one panel.
  const railViews = useSessionRailViews({
    allRuns: flow.allRuns,
    outputs: sessionOutputs,
    given: sessionGiven,
    onFilesShown,
    onFileDeleted: onFilesShown,
    org,
    // How the next turn runs lives in the composer's run settings, beside
    // the model picker, so the inspector carries no Config facet.
    sessionConfig: undefined,
    onApplied,
    onImplementPlan,
    onOpenPlan,
    onOpenFileDocument,
    onActivateFileDocument,
    expectsWriteBack,
    changesSettled: isTerminalPhase(displayPhase),
  });

  // Explorer-footer folder attach (desktop only — needs the native picker).
  // Same wiring the retired Workspace tab used.
  const canAddLocalFolder = enableLocal && !!onBrowseLocalFolder;
  const handleAddLocalFolder = useCallback(async () => {
    const path = await onBrowseLocalFolder?.();
    if (path) flow.workspace.addLocalPath(path);
  }, [onBrowseLocalFolder, flow.workspace.addLocalPath]);

  // Entries decorated with per-entry read refs (the latest write-back commit
  // SHA), so the surface's read-side capabilities — file viewer, tree listing,
  // name search — resolve at the ref the agent's changes actually live on. A
  // read-side projection only: `flow.workspace.entries` stays undecorated for
  // setup and session input.
  const surfaceEntries = useWorkspaceReadRefs(
    flow.allRuns,
    flow.workspace.entries,
  );

  return (
    <WorkspaceSurface
      entries={surfaceEntries}
      lister={workspaceFileLister}
      reader={workspaceFileReader}
      searcher={workspaceContentSearcher}
      view={panel.view}
      onViewChange={panel.setView}
      extraViews={railViews}
      virtualDocuments={virtualDocuments}
      onRemoveEntry={flow.workspace.remove}
      onAddLocalFolder={canAddLocalFolder ? handleAddLocalFolder : undefined}
      editors={editors}
      selectedFile={activeFile}
      onOpenFile={panel.openFile}
      onActivateEditor={panel.activateEditor}
      onPinEditor={panel.pinEditor}
      onCloseEditor={panel.closeEditor}
      onCollapse={panel.closePanel}
      change={openFileChange ?? undefined}
      reveal={activeReveal}
      className="stg:h-full"
    />
  );
}

/**
 * The plan document tab's empty state — reachable only when a streaming plan
 * auto-opened the tab and its turn then ended without publishing (stopped or
 * failed) while the session has no earlier published plan to fall back to.
 * The partial plan reverts to the conversation (the thread un-collapses it),
 * so the notice points there. Never a blank pane.
 */
function PlanUnavailableNotice() {
  return (
    <div
      role="status"
      className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:items-center stg:gap-1 stg:px-4 stg:py-8 stg:text-center"
    >
      <p className="stg:text-xs stg:font-medium stg:text-foreground">
        This turn ended before a plan was completed.
      </p>
      <p className="stg:text-xs stg:text-muted-foreground">
        Any partial plan text remains in the conversation.
      </p>
    </div>
  );
}

/**
 * Shown in a File document tab whose File is no longer among the
 * conversation's (deleted, or replaced at its path by a later turn's). The
 * tab stays closable; the content is honest rather than blank.
 */
function FileUnavailableNotice() {
  return (
    <div
      role="status"
      className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:items-center stg:gap-1 stg:px-4 stg:py-8 stg:text-center"
    >
      <p className="stg:text-xs stg:font-medium stg:text-foreground">
        This file is no longer available.
      </p>
      <p className="stg:text-xs stg:text-muted-foreground">
        It may have been deleted, or replaced by a newer version.
      </p>
    </div>
  );
}

