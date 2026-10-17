import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineDetailView,
  useBreadcrumbOverride,
  useResolveRunSession,
  useOrgSlugForId,
} from "@stigmer/react-sdk";
import { useCanonicalDetailSlug } from "./canonical-slug";

/**
 * Thin shell around the SDK's `RoutineDetailView` (which owns the full
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

  // A schedule's last run is a run (run_…); on
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

  const [loadedSlug, setLoadedSlug] = useState<string | undefined>(undefined);
  const moveToSlug = useCanonicalDetailSlug("schedules", org, slug, loadedSlug);

  const handleResourceLoad = useCallback(
    (loaded: Routine) => {
      setLabel(loaded.metadata?.name || loaded.metadata?.slug || "Schedule");
      setLoadedSlug(loaded.metadata?.slug);
    },
    [setLabel],
  );

  if (!org || !slug) return null;

  return (
    <RoutineDetailView
      org={org}
      slug={slug}
      editable
      onResourceLoad={handleResourceLoad}
      onNavigateToAgent={(agentOrg, agentSlug) =>
        navigate(`/library/agents/${slugForOrg(agentOrg)}/${agentSlug}`)
      }
      onNavigateToRun={setPendingExecutionId}
      onDeleted={() => navigate("/library/schedules")}
      onRenamed={(renamed) => moveToSlug(renamed.metadata?.slug ?? "")}
    />
  );
}
