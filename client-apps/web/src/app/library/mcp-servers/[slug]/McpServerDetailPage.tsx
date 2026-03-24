"use client";

import { useEffect } from "react";
import { McpServerDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../LibraryBreadcrumbContext";

export function McpServerDetailPage() {
  const slug = useStaticRouteParam("slug");
  const org = useActiveOrgSlug();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => () => setLabel(null), [setLabel]);

  if (!slug) return null;

  return (
    <McpServerDetailView
      org={org}
      slug={slug}
      onResourceLoad={({ name }) => setLabel(name)}
    />
  );
}
