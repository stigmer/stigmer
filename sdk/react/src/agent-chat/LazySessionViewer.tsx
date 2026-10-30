"use client";

// The conversation view, loaded as its own chunk: <AgentChat> draws the
// launcher at once and fetches this on mount, so the composer is usable
// before the heavier thread (markdown, highlighting, the run cards) has
// arrived. A conversation reopened before it lands shows the thread's
// loading skeleton, as the view itself does while its session loads.

import { useEffect, useState, type ComponentType } from "react";
import { cn } from "@stigmer/design-tokens";
import { ThreadSkeleton } from "../run/ThreadSkeleton.js";
import type { SessionViewerProps } from "../session/SessionViewer.js";

type Viewer = ComponentType<SessionViewerProps>;

/** One import shared by every chat on the page; cleared on failure so a later mount retries. */
let viewerImport: Promise<Viewer> | null = null;

/** The view once it has loaded, so a later mount draws it at once. */
let loadedViewer: Viewer | undefined;

/** Starts loading the conversation view, if it has not started. */
export function preloadSessionViewer(): Promise<Viewer> {
  viewerImport ??= import("../session/SessionViewer.js").then(
    (module) => (loadedViewer = module.SessionViewer),
    (error: unknown) => {
      viewerImport = null;
      throw error;
    },
  );
  return viewerImport;
}

/** `SessionViewer`, drawn once its chunk has loaded (module header). */
export function LazySessionViewer(props: SessionViewerProps) {
  const [state, setState] = useState<{ readonly viewer?: Viewer; readonly failed?: boolean }>(() => ({ viewer: loadedViewer }));

  useEffect(() => {
    if (loadedViewer) return;
    let live = true;
    preloadSessionViewer().then(
      (viewer) => live && setState({ viewer }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, []);

  if (state.viewer) {
    const SessionViewer = state.viewer;
    return <SessionViewer {...props} />;
  }
  if (state.failed) {
    return (
      <div
        role="alert"
        className={cn(
          "stg:flex stg:h-full stg:w-full stg:flex-col stg:items-center stg:justify-center stg:gap-1 stg:p-6 stg:text-center stg:text-sm stg:text-muted-foreground",
          props.className,
        )}
      >
        <span>The conversation could not load.</span>
        <span>Reload the page to try again.</span>
      </div>
    );
  }
  return (
    <div className={cn("stg:flex stg:h-full stg:w-full stg:flex-col", props.className)}>
      <ThreadSkeleton className="stg:flex-1 stg:px-0" />
    </div>
  );
}
