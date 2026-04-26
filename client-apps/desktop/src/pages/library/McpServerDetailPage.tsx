import { useParams } from "react-router-dom";
import { McpServerDetailView, useActiveOrgSlug } from "@stigmer/react";

export default function McpServerDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const activeOrg = useActiveOrgSlug();

  if (!org || !slug) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <McpServerDetailView org={org} slug={slug} activeOrg={activeOrg} />
    </div>
  );
}
