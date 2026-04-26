import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { AgentDetailView, useUpdateVisibility } from "@stigmer/react";
import { useBreadcrumbOverride } from "@stigmer/react";

export default function AgentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
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
          to={`/?draft=agent&editOrg=${encodeURIComponent(org)}&editSlug=${encodeURIComponent(slug)}`}
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
        onMcpServerClick={(ref) =>
          navigate(`/library/mcp-servers/${ref.org}/${ref.slug}`)
        }
        onSkillClick={(ref) =>
          navigate(`/library/skills/${ref.org}/${ref.slug}`)
        }
        onVisibilityChange={updateVisibility}
        isVisibilityPending={isPending}
      />
    </div>
  );
}
