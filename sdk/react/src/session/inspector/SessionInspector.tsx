"use client";

// The builder mode of the session viewers: the explorer, editor tabs, search,
// Changes and Files beside the conversation, with the chip that opens them.
// A host turns it on by passing the part (the console and the desktop app
// do); an embed that passes none shows the conversation alone, every Files
// and change still opening in place from the turn that produced it.
//
//   <SessionViewer sessionId={id} org={org} inspector={<SessionInspector />} />
//
// The element carries what only the inspector reads: the local workspace
// readers (the desktop app's) and how the panel opens. The viewer reads the
// open props to drive its panel controller and renders this element inside
// its scope; outside a viewer it renders nothing.

import { useSessionInspectorScope } from "./SessionInspectorContext.js";
import { LaunchInspectorRegion } from "./LaunchInspectorRegion.js";
import { SessionInspectorRegion, type SessionInspectorReaders } from "./SessionInspectorRegion.js";

/** Props for {@link SessionInspector}. */
export interface SessionInspectorProps extends SessionInspectorReaders {
  /**
   * Initial open state in uncontrolled mode: a docking host that wants the
   * workspace visible from the first paint passes `true`. Ignored when
   * {@link SessionInspectorProps.open} is given.
   *
   * @default false
   */
  readonly defaultOpen?: boolean;
  /**
   * Controlled open state. When given, the host owns the panel: the chip,
   * file and plan opens, and a streaming plan's auto-open surface through
   * {@link SessionInspectorProps.onOpenChange} instead of flipping state.
   */
  readonly open?: boolean;
  /** Called on every open and close, controlled or not. */
  readonly onOpenChange?: (open: boolean) => void;
}

/** The session viewer's builder mode (module header). */
export function SessionInspector({ workspaceFileLister, workspaceFileReader, workspaceContentSearcher }: SessionInspectorProps) {
  const inspector = useSessionInspectorScope();
  if (inspector === null) return null;
  const readers = { workspaceFileLister, workspaceFileReader, workspaceContentSearcher };
  return inspector.kind === "session" ? (
    <SessionInspectorRegion {...inspector.scope} {...readers} />
  ) : (
    <LaunchInspectorRegion {...inspector.scope} {...readers} />
  );
}
