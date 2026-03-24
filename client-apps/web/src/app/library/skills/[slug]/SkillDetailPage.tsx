"use client";

import { useEffect } from "react";
import { SkillDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../LibraryBreadcrumbContext";

export function SkillDetailPage() {
  const slug = useStaticRouteParam("slug");
  const org = useActiveOrgSlug();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => () => setLabel(null), [setLabel]);

  if (!slug) return null;

  return (
    <SkillDetailView
      org={org}
      slug={slug}
      onResourceLoad={({ name }) => setLabel(name)}
    />
  );
}
