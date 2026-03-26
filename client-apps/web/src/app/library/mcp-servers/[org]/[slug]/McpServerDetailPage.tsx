"use client";

import { useCallback, useEffect, useState } from "react";
import { McpServerDetailView, useUpdateVisibility } from "@stigmer/react";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../../LibraryBreadcrumbContext";

export function McpServerDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");
  const { setLabel } = useBreadcrumbOverride();
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

  if (!org || !slug) return null;

  return (
    <McpServerDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
      onVisibilityChange={updateVisibility}
      isVisibilityPending={isPending}
    />
  );
}
