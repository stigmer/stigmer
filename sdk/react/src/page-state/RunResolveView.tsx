"use client";

// The page at a run's address (`/runs/<id>`, which the dashboard's failed
// runs and a routine's runs open). A run is viewed in the conversation it
// ran in, so the page resolves the run's session and hands it to the host,
// which goes there, saying meanwhile that it is opening it. A run that
// doesn't resolve (an unknown id, a run the caller can't see, a run without
// a session) isn't here, in the agent page's words; a failed read says so
// with Try again, so a passing failure never reads as a missing run. Both
// consoles draw it, inside their frame.

import { useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { PageFrame } from "../page-frame/PageFrame.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useResolveRunSession } from "../run/useResolveRunSession.js";

/** Props for {@link RunResolveView}. */
export interface RunResolveViewProps {
  /** The run (`run_*`) whose conversation to open. */
  readonly runId: string;
  /** Goes to the run's conversation, called once its session resolves. */
  readonly onResolved: (sessionId: string) => void;
  /** Where "Go to conversations" leads, for a run that isn't here. */
  readonly conversationsHref: string;
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
 *     <RunResolveView runId={runId} onResolved={(sessionId) => window.location.assign(`/sessions/${sessionId}`)} conversationsHref="/conversations" />
 *   );
 * }
 * ```
 */
export function RunResolveView({ runId, onResolved, conversationsHref, renderLink }: RunResolveViewProps) {
  const { sessionId, isLoading, error, refetch } = useResolveRunSession(runId);

  useEffect(() => {
    if (sessionId) onResolved(sessionId);
  }, [sessionId, onResolved]);

  if (isLoading || sessionId) {
    return (
      <PageFrame>
        <p role="status" className="stg:m-0 stg:flex stg:items-center stg:gap-3 stg:text-sm stg:text-muted-foreground">
          <SpinnerIcon size={20} />
          Opening the conversation…
        </p>
      </PageFrame>
    );
  }

  if (error) {
    return (
      <PageFrame>
        <ErrorMessage error={error} title="Stigmer couldn't open this run." comfort="The run itself is unaffected." retry={refetch} />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <EmptyState
        variant="first-use"
        icon={<MessageSquare />}
        title="This run isn't here"
        description="It may have been deleted, or it belongs to an organization you're not in."
      >
        <LinkButton href={conversationsHref} variant="outline" renderLink={renderLink}>
          Go to conversations
        </LinkButton>
      </EmptyState>
    </PageFrame>
  );
}
