"use client";

// The launcher's inspector: before a conversation exists the only thing to
// inspect is what it will work on, so the region is the attached
// workspaces' explorer and editor (a local folder added from its footer on
// the desktop app). How the first turn runs is in the composer's run
// settings, as in a conversation.

import { useCallback } from "react";
import { useWorkspaceEditors } from "../../internal/store/index.js";
import { WorkspaceSurface } from "../../workspace/WorkspaceSurface.js";
import type { useNewSessionFlow } from "../useNewSessionFlow.js";
import type { SessionPanelController } from "../useSessionPanel.js";
import type { SessionInspectorReaders } from "./SessionInspectorRegion.js";

/** @internal What NewSessionViewer hands its inspector. */
export interface LaunchInspectorScope {
  readonly workspace: ReturnType<typeof useNewSessionFlow>["workspace"];
  readonly panel: SessionPanelController;
  /** Picks a local folder (desktop); omitted where none can be picked. */
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
}

/** Props for {@link LaunchInspectorRegion}. */
export interface LaunchInspectorRegionProps extends LaunchInspectorScope, SessionInspectorReaders {}

/** The launcher's inspector region (module header). */
export function LaunchInspectorRegion({
  workspace,
  panel,
  onBrowseLocalFolder,
  workspaceFileLister,
  workspaceFileReader,
  workspaceContentSearcher,
}: LaunchInspectorRegionProps) {
  const { editors, activeKey, activeFile, reveal } = useWorkspaceEditors(panel.editorsStore);
  // Honor a jump-to-line reveal only while it targets the active editor.
  const activeReveal = reveal && reveal.key === activeKey ? reveal : undefined;
  const addLocalPath = workspace.addLocalPath;
  const handleAddLocalFolder = useCallback(async () => {
    const path = await onBrowseLocalFolder?.();
    if (path) addLocalPath(path);
  }, [onBrowseLocalFolder, addLocalPath]);

  return (
    <WorkspaceSurface
      entries={workspace.entries}
      lister={workspaceFileLister}
      reader={workspaceFileReader}
      searcher={workspaceContentSearcher}
      view={panel.view}
      onViewChange={panel.setView}
      onRemoveEntry={workspace.remove}
      onAddLocalFolder={onBrowseLocalFolder ? handleAddLocalFolder : undefined}
      editors={editors}
      selectedFile={activeFile}
      onOpenFile={panel.openFile}
      onActivateEditor={panel.activateEditor}
      onPinEditor={panel.pinEditor}
      onCloseEditor={panel.closeEditor}
      onCollapse={panel.closePanel}
      reveal={activeReveal}
      className="stg:h-full"
    />
  );
}
