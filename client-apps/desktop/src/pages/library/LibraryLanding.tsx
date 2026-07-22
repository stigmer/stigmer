import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Database, FileCode2, Sparkles, Server, Workflow } from "lucide-react";
import { cn } from "@stigmer/theme";
import {
  ApplyManifestDialog,
  useAgentCount,
  useDatastoreCount,
  useSkillCount,
  useMcpServerCount,
  useWorkflowCount,
  useActiveOrgSlug,
  ResourceCountCard,
} from "@stigmer/react";

export default function LibraryLanding() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const agents = useAgentCount(org);
  const workflows = useWorkflowCount(org);
  const skills = useSkillCount(org);
  const mcpServers = useMcpServerCount(org);
  const datastores = useDatastoreCount(org);
  const [applyYamlOpen, setApplyYamlOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Library</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResourceCountCard
          icon={<Bot className="size-5" aria-hidden="true" />}
          label="Agents"
          count={agents.count}
          isLoading={agents.isLoading}
          onClick={() => navigate("/library/agents")}
        />
        <ResourceCountCard
          icon={<Workflow className="size-5" aria-hidden="true" />}
          label="Workflows"
          count={workflows.count}
          isLoading={workflows.isLoading}
          onClick={() => navigate("/library/workflows")}
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
        <ResourceCountCard
          icon={<Database className="size-5" aria-hidden="true" />}
          label="Datastores"
          count={datastores.count}
          isLoading={datastores.isLoading}
          onClick={() => navigate("/library/datastores")}
        />
      </div>

      {/* Declarative entry point — wired identically to the web Library
          landing (DD-016 parity). */}
      <button
        type="button"
        onClick={() => setApplyYamlOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
          "text-muted-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <FileCode2 className="size-3.5" aria-hidden="true" />
        Apply YAML
      </button>

      <ApplyManifestDialog
        open={applyYamlOpen}
        onOpenChange={setApplyYamlOpen}
        org={org ?? ""}
      />
    </div>
  );
}
