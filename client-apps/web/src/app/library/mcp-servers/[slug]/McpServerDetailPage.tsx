"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { McpServerDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useBreadcrumbOverride } from "../../LibraryBreadcrumbContext";

export function McpServerDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const org = useActiveOrgSlug();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => () => setLabel(null), [setLabel]);

  return (
    <McpServerDetailView
      org={org}
      slug={slug}
      onResourceLoad={({ name }) => setLabel(name)}
    />
  );
}
