"use client";

import { useParams } from "next/navigation";
import { McpServerDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

export function McpServerDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const org = useActiveOrgSlug();

  return <McpServerDetailView org={org} slug={slug} />;
}
