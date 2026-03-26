"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { AgentDetailView, useUpdateVisibility } from "@stigmer/react";
import { getEditSessionUrl } from "@/utils/draft-session";
import { navigateTo } from "@/utils/navigation";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../../LibraryBreadcrumbContext";

export function AgentDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);

  const { updateVisibility, isPending } = useUpdateVisibility(
    "agent",
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
        onResourceLoad={handleResourceLoad}
        onMcpServerClick={({ org: o, slug: s }) =>
          navigateTo(`/library/mcp-servers/${o}/${s}`)
        }
        onSkillClick={({ org: o, slug: s }) =>
          navigateTo(`/library/skills/${o}/${s}`)
        }
        onVisibilityChange={updateVisibility}
        isVisibilityPending={isPending}
      />
    </div>
  );
}
