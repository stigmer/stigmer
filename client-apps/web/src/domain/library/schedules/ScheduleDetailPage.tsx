"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineDetailView, useBreadcrumbOverride } from "@stigmer/react";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "@/domain/library/library-navigation";
import { useRunNavigation } from "@/domain/runs/run-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

/**
 * Read the `?tab=` deep-link target once, at mount.
 *
 * Lets external surfaces land directly on a specific tab — e.g.
 * `?tab=history`. Read from `window.location` instead of `useSearchParams()`
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
  const { navigateToDetail, canonicalSlug } = useLibraryNavigation();
  const { navigateToRun } = useRunNavigation();

  // Controlled tab state seeded from the ?tab= deep link so cross-surface
  // handoffs land on the right tab (the AgentDetailPage precedent).
  const [activeTab, setActiveTab] = useState<string>(
    () => initialTabFromUrl() ?? "overview",
  );

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    (loaded: Routine) => {
      setLabel(loaded.metadata?.name || loaded.metadata?.slug || "Schedule");
      // The read answers the schedule's current slug: a URL naming one it
      // was renamed away from (which still leads to it) moves to it in place.
      if (loaded.metadata?.slug) canonicalSlug(loaded.metadata.slug);
    },
    [setLabel, canonicalSlug],
  );

  return (
    <RoutineDetailView
      org={org}
      slug={slug}
      editable
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onResourceLoad={handleResourceLoad}
      onNavigateToAgent={(agentOrg, agentSlug) =>
        navigateToDetail("agents", agentOrg, agentSlug)
      }
      onNavigateToRun={navigateToRun}
      onDeleted={() => router.push("/library/schedules")}
      onRenamed={(renamed) => {
        if (renamed.metadata?.slug) canonicalSlug(renamed.metadata.slug);
      }}
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
