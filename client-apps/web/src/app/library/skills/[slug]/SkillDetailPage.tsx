"use client";

import { useCallback, useEffect, useState } from "react";
import { SkillDetailView, useUpdateVisibility } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../LibraryBreadcrumbContext";

export function SkillDetailPage() {
  const slug = useStaticRouteParam("slug");
  const org = useActiveOrgSlug();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);

  const { updateVisibility, isPending } = useUpdateVisibility(
    "skill",
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

  if (!slug) return null;

  return (
    <SkillDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
      onVisibilityChange={updateVisibility}
      isVisibilityPending={isPending}
    />
  );
}
