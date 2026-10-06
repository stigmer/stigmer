/**
 * The page at /runs/<id>, the address of a run (the dashboard's failed runs
 * and a schedule's runs open it). A run is viewed in the session it ran in:
 * the page resolves the run's session and replaces its own history entry
 * with /sessions/<id>, rendering nothing meanwhile. When no run resolves (an
 * unknown id, or a run without a session) it shows a not-found state.
 */
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import { useResolveAgentRunSession } from "@stigmer/react";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessionId, isLoading } = useResolveAgentRunSession(id ?? null);

  useEffect(() => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}`, { replace: true });
    }
  }, [sessionId, navigate]);

  if (isLoading || sessionId) return null;

  return <RunNotFound />;
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

        <Link
          to="/dashboard"
          className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-medium transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
