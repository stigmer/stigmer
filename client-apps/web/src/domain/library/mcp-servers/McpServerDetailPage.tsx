"use client";

import { useCallback, useEffect, useState } from "react";
import { McpServerDetailView, useUpdateVisibility } from "@stigmer/react";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "@/domain/library/LibraryBreadcrumbContext";
import { useActiveOrgSlug } from "@/domain/_shared/org/org-context";

interface McpServerDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function McpServerDetailPageInner({
  org,
  slug,
}: McpServerDetailPageInnerProps) {
  const { setLabel } = useBreadcrumbOverride();
  const activeOrgSlug = useActiveOrgSlug();
  const [resourceId, setResourceId] = useState<string | null>(null);

  const { updateVisibility, isPending } = useUpdateVisibility(
    "mcpServer",
    resourceId,
  );

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    ({ name, id }: { name: string; id: string }) => {
      setLabel(name);
      setResourceId(id);
    },
    [setLabel],
  );

  return (
    <McpServerDetailView
      org={org}
      slug={slug}
      activeOrg={activeOrgSlug}
      onResourceLoad={handleResourceLoad}
      onVisibilityChange={updateVisibility}
      isVisibilityPending={isPending}
    />
  );
}

export function McpServerDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <McpServerDetailPageInner org={org} slug={slug} />;
}
