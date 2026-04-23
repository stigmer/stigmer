import { useParams, useNavigate } from "react-router-dom";
import { AgentDetailView } from "@stigmer/react";

export default function AgentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();

  if (!org || !slug) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <AgentDetailView
        org={org}
        slug={slug}
        onMcpServerClick={(ref) =>
          navigate(`/library/mcp-servers/${ref.org}/${ref.slug}`)
        }
        onSkillClick={(ref) =>
          navigate(`/library/skills/${ref.org}/${ref.slug}`)
        }
      />
    </div>
  );
}
