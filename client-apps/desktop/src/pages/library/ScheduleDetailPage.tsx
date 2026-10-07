import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleDetailView,
  useBreadcrumbOverride,
  useResolveRunSession,
  useOrgSlugForId,
} from "@stigmer/react";

/**
 * Thin shell around the SDK's `ScheduleDetailView` (which owns the full
 * action set — trigger, resume, enable/disable, inline editing, YAML,
 * delete): the page contributes only breadcrumb label sync and the
 * navigation seams. Wired identically to the web page,
 * with React Router in place of Next navigation; tabs stay uncontrolled
 * because desktop routes carry no `?tab=` deep-link convention.
 */
export default function ScheduleDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const slugForOrg = useOrgSlugForId();
  const { setLabel } = useBreadcrumbOverride();

  // A schedule's last run is an agent run (aex_…); on
  // desktop it is viewed through its parent session — the same
  // resolve-then-navigate pattern as the run page (pages/runs/RunPage).
  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(null);
  const { sessionId } = useResolveRunSession(pendingExecutionId);

  useEffect(() => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}`);
    }
  }, [sessionId, navigate]);

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    (loaded: Schedule) => {
      setLabel(loaded.metadata?.name || loaded.metadata?.slug || "Schedule");
    },
    [setLabel],
  );

  if (!org || !slug) return null;

  return (
    <ScheduleDetailView
      org={org}
      slug={slug}
      editable
      onResourceLoad={handleResourceLoad}
      onNavigateToAgent={(agentOrg, agentSlug) =>
        navigate(`/library/agents/${slugForOrg(agentOrg)}/${agentSlug}`)
      }
      onNavigateToRun={setPendingExecutionId}
      onDeleted={() => navigate("/library/schedules")}
    />
  );
}
