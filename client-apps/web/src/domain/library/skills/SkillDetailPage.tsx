"use client";

import { useCallback, useEffect, useState } from "react";
import { SkillDetailView, useUpdateVisibility } from "@stigmer/react";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "@stigmer/react";

interface SkillDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function SkillDetailPageInner({ org, slug }: SkillDetailPageInnerProps) {
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

export function SkillDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <SkillDetailPageInner org={org} slug={slug} />;
}
