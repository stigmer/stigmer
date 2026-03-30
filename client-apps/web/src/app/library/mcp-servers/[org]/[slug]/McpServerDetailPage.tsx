"use client";

import { useCallback, useEffect, useState } from "react";
import { McpServerDetailView, useUpdateVisibility } from "@stigmer/react";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../../LibraryBreadcrumbContext";
import { useSessionNavigation } from "@/contexts/session-navigation";

interface McpServerDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function McpServerDetailPageInner({
  org,
  slug,
}: McpServerDetailPageInnerProps) {
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const { navigateToSession } = useSessionNavigation();

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

  const handlePolicySessionCreated = useCallback(
    ({ sessionId }: { sessionId: string }) => {
      navigateToSession(sessionId);
    },
    [navigateToSession],
  );

  return (
    <McpServerDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
      onVisibilityChange={updateVisibility}
      isVisibilityPending={isPending}
      onPolicySessionCreated={handlePolicySessionCreated}
    />
  );
}

export function McpServerDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <McpServerDetailPageInner org={org} slug={slug} />;
}
