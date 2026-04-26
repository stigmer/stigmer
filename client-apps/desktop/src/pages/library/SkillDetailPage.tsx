import { useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { SkillDetailView } from "@stigmer/react";
import { useBreadcrumbOverride } from "@stigmer/react";

export default function SkillDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    ({ name }: { name: string }) => {
      setLabel(name);
    },
    [setLabel],
  );

  if (!org || !slug) return null;

  return (
    <SkillDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
    />
  );
}
