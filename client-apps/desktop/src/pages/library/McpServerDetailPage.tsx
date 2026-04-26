import { useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { McpServerDetailView, useActiveOrgSlug } from "@stigmer/react";
import { useBreadcrumbOverride } from "@stigmer/react";

export default function McpServerDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const activeOrg = useActiveOrgSlug();
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
    <McpServerDetailView
      org={org}
      slug={slug}
      activeOrg={activeOrg}
      onResourceLoad={handleResourceLoad}
    />
  );
}
