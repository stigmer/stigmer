"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentDetailView, useBreadcrumbOverride } from "@stigmer/react-sdk";
import { useLibraryNavigation, useRouteDetailYieldsToOverlay } from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

interface EnvironmentDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

/**
 * Thin shell around the SDK's `EnvironmentDetailView` (which owns the
 * editors, rename, access, export and delete): the page contributes the
 * breadcrumb label, the canonical slug, and the route after a delete.
 */
export function EnvironmentDetailPageInner({ org, slug }: EnvironmentDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const { canonicalSlug } = useLibraryNavigation();

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    (loaded: Environment) => {
      setLabel(loaded.metadata?.name || loaded.metadata?.slug || "Environment");
      // A URL naming a slug the Environment was renamed away from (which
      // still leads to it) moves to its current one in place.
      if (loaded.metadata?.slug) canonicalSlug(loaded.metadata.slug);
    },
    [setLabel, canonicalSlug],
  );

  return (
    <EnvironmentDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
      onDeleted={() => router.push("/library/environments")}
      onRenamed={(renamed) => {
        if (renamed.metadata?.slug) canonicalSlug(renamed.metadata.slug);
      }}
    />
  );
}

export function EnvironmentDetailPage() {
  // The zone overlay owns detail rendering while it is active (oss#621).
  const yieldsToOverlay = useRouteDetailYieldsToOverlay();
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (yieldsToOverlay || !org || !slug) return null;

  return <EnvironmentDetailPageInner org={org} slug={slug} />;
}
