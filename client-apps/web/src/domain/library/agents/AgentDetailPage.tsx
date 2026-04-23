"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { AgentDetailView, useUpdateVisibility } from "@stigmer/react";
import { getEditSessionUrl } from "@/domain/session/draft-session";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { useBreadcrumbOverride } from "../../../LibraryBreadcrumbContext";

interface AgentDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function AgentDetailPageInner({ org, slug }: AgentDetailPageInnerProps) {
  const { setLabel } = useBreadcrumbOverride();
  const { navigateToDetail } = useLibraryNavigation();
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
          navigateToDetail("mcp-servers", o, s)
        }
        onSkillClick={({ org: o, slug: s }) =>
          navigateToDetail("skills", o, s)
        }
        onVisibilityChange={updateVisibility}
        isVisibilityPending={isPending}
      />
    </div>
  );
}

export function AgentDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <AgentDetailPageInner org={org} slug={slug} />;
}
