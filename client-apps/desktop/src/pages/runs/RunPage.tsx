/**
 * The page at /runs/<id>, the address of a run (the dashboard's failed runs
 * and a routine's runs open it). A run is viewed in the session it ran in:
 * the page resolves the run's session and replaces its own history entry
 * with /sessions/<id>, rendering nothing meanwhile. When no run resolves (an
 * unknown id, a run the caller cannot see, or a run without a session) it
 * shows a not-found state; when reading the run failed for another reason
 * (the network, the server) it says so and offers a retry, so a transient
 * failure never reads as a missing run.
 */
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, FileQuestion, RotateCcw } from "lucide-react";
import { getUserMessage } from "@stigmer/client";
import { Button, LinkButton, useResolveRunSession } from "@stigmer/react-sdk";
import { renderJourneyLink } from "../../journey/journey-links";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessionId, isLoading, error, refetch } = useResolveRunSession(id ?? null);

  useEffect(() => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}`, { replace: true });
    }
  }, [sessionId, navigate]);

  if (isLoading || sessionId) return null;
  if (error) return <RunLoadFailed error={error} onRetry={refetch} />;

  return <RunNotFound />;
}

function RunLoadFailed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive-subtle mx-auto flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="text-destructive size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Failed to load run</h1>
          <p className="text-muted-foreground text-sm">{getUserMessage(error)}</p>
        </div>

        <Button variant="outline" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function RunNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-muted mx-auto flex size-12 items-center justify-center rounded-full">
          <FileQuestion className="text-muted-foreground size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Run not found</h1>
          <p className="text-muted-foreground text-sm">
            The run you&apos;re looking for doesn&apos;t exist or you don&apos;t
            have access to it.
          </p>
        </div>

        <LinkButton href="/dashboard" renderLink={renderJourneyLink}>
          Go to Dashboard
        </LinkButton>
      </div>
    </div>
  );
}
