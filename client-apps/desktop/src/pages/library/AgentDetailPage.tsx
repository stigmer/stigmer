import { useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AgentDetailView } from "@stigmer/react";
import { useBreadcrumbOverride } from "@stigmer/react";

export default function AgentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
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
    />
  );
}
