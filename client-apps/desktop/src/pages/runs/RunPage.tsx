/**
 * The page at /runs/<id>, the address of a run (the dashboard's failed runs
 * and a routine's runs open it). A run is viewed in the session it ran in:
 * the kit's `RunResolveView` resolves the run's session, and this page
 * replaces its own history entry with /sessions/<id>. The view draws the
 * run that isn't there and the read that failed, as the web console's run
 * zone does.
 */
import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RunResolveView } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const openSession = useCallback(
    (sessionId: string) => navigate(`/sessions/${sessionId}`, { replace: true }),
    [navigate],
  );

  return (
    <RunResolveView
      key={id}
      runId={id ?? ""}
      onResolved={openSession}
      dashboardHref="/dashboard"
      renderLink={renderJourneyLink}
    />
  );
}
