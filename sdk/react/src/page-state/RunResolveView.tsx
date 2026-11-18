"use client";

// The page at a run's address (`/runs/<id>`, which the dashboard's failed
// runs and a routine's runs open). A run is viewed in the conversation it
// ran in, so the page resolves the run's session and hands it to the host,
// which goes there; it draws nothing meanwhile. A run that doesn't resolve
// (an unknown id, a run the caller can't see, a run without a session) is
// "not found"; a failed read says so with Try again, so a passing failure
// never reads as a missing run. Both consoles draw it.

import { useEffect } from "react";
import { AlertTriangle, FileQuestion, RotateCcw } from "lucide-react";
import { getUserMessage } from "@stigmer/client";
import { Button } from "../button/Button.js";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { StatePanel } from "./StatePanel.js";
import { useResolveRunSession } from "../run/useResolveRunSession.js";

/** Props for {@link RunResolveView}. */
export interface RunResolveViewProps {
  /** The run (`run_*`) whose conversation to open. */
  readonly runId: string;
  /** Goes to the run's conversation, called once its session resolves. */
  readonly onResolved: (sessionId: string) => void;
  /** Where "Go to Dashboard" leads (the web console's `/`, the desktop app's `/dashboard`). */
  readonly dashboardHref: string;
  /** Draws the link with the host's router; a plain anchor when omitted. */
  readonly renderLink?: RenderLink;
}

/**
 * Opens a run's conversation, or says why it can't.
 *
 * @example
 * ```tsx
 * function RunPage({ runId }: { runId: string }) {
 *   return (
 *     <RunResolveView runId={runId} onResolved={(sessionId) => window.location.assign(`/sessions/${sessionId}`)} dashboardHref="/" />
 *   );
 * }
 * ```
 */
export function RunResolveView({ runId, onResolved, dashboardHref, renderLink }: RunResolveViewProps) {
  const { sessionId, isLoading, error, refetch } = useResolveRunSession(runId);

  useEffect(() => {
    if (sessionId) onResolved(sessionId);
  }, [sessionId, onResolved]);

  if (isLoading || sessionId) return null;

  const home = (
    <LinkButton href={dashboardHref} variant={error ? "ghost" : "primary"} renderLink={renderLink}>
      Go to Dashboard
    </LinkButton>
  );

  if (error) {
    return (
      <StatePanel
        placement="page"
        tone="failed"
        icon={<AlertTriangle className="stg:size-6" />}
        title="Failed to load run"
        headingLevel={1}
        description={getUserMessage(error)}
        acts={
          <>
            <Button variant="outline" onClick={refetch} icon={<RotateCcw className="stg:size-3.5" />}>
              Try again
            </Button>
            {home}
          </>
        }
      />
    );
  }

  return (
    <StatePanel
      placement="page"
      tone="quiet"
      icon={<FileQuestion className="stg:size-6" />}
      title="Run not found"
      headingLevel={1}
      description="The run you're looking for doesn't exist or you don't have access to it."
      acts={home}
    />
  );
}
