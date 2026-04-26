import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  McpServerDetailView,
  useActiveOrgSlug,
  useUpdateVisibility,
} from "@stigmer/react";
import { useBreadcrumbOverride } from "@stigmer/react";

export default function McpServerDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const activeOrg = useActiveOrgSlug();
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
      activeOrg={activeOrg}
      onResourceLoad={handleResourceLoad}
      onVisibilityChange={updateVisibility}
      isVisibilityPending={isPending}
    />
  );
}
