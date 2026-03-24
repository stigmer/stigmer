"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { AgentDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { getEditSessionUrl } from "@/utils/draft-session";
import { navigateTo } from "@/utils/navigation";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../LibraryBreadcrumbContext";

export function AgentDetailPage() {
  const slug = useStaticRouteParam("slug");
  const org = useActiveOrgSlug();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => () => setLabel(null), [setLabel]);

  if (!slug) return null;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href={getEditSessionUrl("agent", org, slug)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit
        </Link>
      </div>

      <AgentDetailView
        org={org}
        slug={slug}
        onResourceLoad={({ name }) => setLabel(name)}
        onMcpServerClick={({ slug: s }) =>
          navigateTo(`/library/mcp-servers/${s}`)
        }
        onSkillClick={({ slug: s }) => navigateTo(`/library/skills/${s}`)}
      />
    </div>
  );
}
