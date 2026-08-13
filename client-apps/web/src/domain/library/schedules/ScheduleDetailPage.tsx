"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleDetailView, useBreadcrumbOverride } from "@stigmer/react";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "@/domain/library/library-navigation";
import { useExecutionNavigation } from "@/domain/workflow/execution-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

/**
 * Read the `?tab=` deep-link target once, at mount.
 *
 * Lets external surfaces land directly on a specific tab — e.g.
 * `?tab=runs`. Read from `window.location` instead of `useSearchParams()`
 * because tab state is deliberately local after landing (the
 * AgentDetailPage precedent) and the static-export prerender has no URL
 * to read (the `useStaticRouteParam` idiom).
 */
function initialTabFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("tab") ?? undefined;
}

interface ScheduleDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

/**
 * Thin shell around the SDK's `ScheduleDetailView` (which owns the full
 * action set — trigger, resume, enable/disable, inline editing, YAML,
 * delete): the page contributes only breadcrumb label sync, tab
 * deep-linking, and the navigation seams.
 */
export function ScheduleDetailPageInner({
  org,
  slug,
}: ScheduleDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const { navigateToDetail } = useLibraryNavigation();
  const { navigateToExecution } = useExecutionNavigation();

  // Controlled tab state seeded from the ?tab= deep link so cross-surface
  // handoffs land on the right tab (the AgentDetailPage precedent).
  const [activeTab, setActiveTab] = useState<string>(
    () => initialTabFromUrl() ?? "overview",
  );

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
      editable
      activeTab={activeTab}
      onTabChange={setActiveTab}
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
  // The zone overlay owns detail rendering while it is active (oss#621).
  const yieldsToOverlay = useRouteDetailYieldsToOverlay();
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (yieldsToOverlay || !org || !slug) return null;

  return <ScheduleDetailPageInner org={org} slug={slug} />;
}
