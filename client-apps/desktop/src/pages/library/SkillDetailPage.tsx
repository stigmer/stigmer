import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SkillDetailView, useUpdateVisibility } from "@stigmer/react";
import { useBreadcrumbOverride } from "@stigmer/react";

export default function SkillDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
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

  if (!org || !slug) return null;

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
