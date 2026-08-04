"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleDetailView, useBreadcrumbOverride } from "@stigmer/react";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { useExecutionNavigation } from "@/domain/workflow/execution-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

interface ScheduleDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

/**
 * Thin shell around the SDK's `ScheduleDetailView` (which owns the full
 * action set — trigger, resume, enable/disable, YAML, delete): the page
 * contributes only breadcrumb label sync and the navigation seams.
 */
export function ScheduleDetailPageInner({
  org,
  slug,
}: ScheduleDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const { navigateToDetail } = useLibraryNavigation();
  const { navigateToExecution } = useExecutionNavigation();

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    (loaded: Schedule) => {
      setLabel(loaded.metadata?.name || loaded.metadata?.slug || "Schedule");
    },
    [setLabel],
  );

  return (
    <ScheduleDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
      onNavigateToAgent={(agentOrg, agentSlug) =>
        navigateToDetail("agents", agentOrg, agentSlug)
      }
      onNavigateToExecution={navigateToExecution}
      onDeleted={() => router.push("/library/schedules")}
    />
  );
}

export function ScheduleDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <ScheduleDetailPageInner org={org} slug={slug} />;
}
