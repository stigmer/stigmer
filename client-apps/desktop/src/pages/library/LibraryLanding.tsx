import { useNavigate } from "react-router-dom";
import { Bot, Sparkles, Server } from "lucide-react";
import {
  useAgentCount,
  useSkillCount,
  useMcpServerCount,
  ResourceCountCard,
} from "@stigmer/react";
import { useActiveOrgSlug } from "../../org/OrgProvider";

export default function LibraryLanding() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const agents = useAgentCount(org);
  const skills = useSkillCount(org);
  const mcpServers = useMcpServerCount(org);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-lg font-semibold">Library</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ResourceCountCard
          icon={<Bot className="size-5" aria-hidden="true" />}
          label="Agents"
          count={agents.count}
          isLoading={agents.isLoading}
          onClick={() => navigate("/library/agents")}
        />
        <ResourceCountCard
          icon={<Sparkles className="size-5" aria-hidden="true" />}
          label="Skills"
          count={skills.count}
          isLoading={skills.isLoading}
          onClick={() => navigate("/library/skills")}
        />
        <ResourceCountCard
          icon={<Server className="size-5" aria-hidden="true" />}
          label="MCP Servers"
          count={mcpServers.count}
          isLoading={mcpServers.isLoading}
          onClick={() => navigate("/library/mcp-servers")}
        />
      </div>
    </div>
  );
}
