import { useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Blocks, Bot, Box, CalendarClock, FileCode2, Files, Sparkles } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import {
  ApplyManifestDialog,
  useAgentCount,
  useRoutineCount,
  useEnvironmentCount,
  useFileCount,
  useSkillCount,
  usePluginCount,
  ResourceCountCard,
  useActiveOrgId,
} from "@stigmer/react-sdk";

export default function LibraryLanding() {
  const org = useActiveOrgId();
  const navigate = useNavigate();
  // Apply YAML here can create any kind, so a bump recounts every card.
  const [refetchToken, refreshCounts] = useReducer((n: number) => n + 1, 0);
  const agents = useAgentCount(org, { refetchToken });
  const skills = useSkillCount(org, { refetchToken });
  const routines = useRoutineCount(org, { refetchToken });
  const plugins = usePluginCount(org, { refetchToken });
  const environments = useEnvironmentCount(org, { refetchToken });
  const files = useFileCount(org, { refetchToken });
  const [applyYamlOpen, setApplyYamlOpen] = useState(false);

  return (
    <div className="space-y-6">
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
          icon={<CalendarClock className="size-5" aria-hidden="true" />}
          label="Routines"
          count={routines.count}
          countIsLowerBound={routines.isLowerBound}
          isLoading={routines.isLoading}
          onClick={() => navigate("/library/routines")}
        />
        <ResourceCountCard
          icon={<Blocks className="size-5" aria-hidden="true" />}
          label="Plugins"
          count={plugins.count}
          isLoading={plugins.isLoading}
          onClick={() => navigate("/library/plugins")}
        />
        <ResourceCountCard
          icon={<Box className="size-5" aria-hidden="true" />}
          label="Environments"
          count={environments.count}
          countIsLowerBound={environments.isLowerBound}
          isLoading={environments.isLoading}
          onClick={() => navigate("/library/environments")}
        />
        <ResourceCountCard
          icon={<Files className="size-5" aria-hidden="true" />}
          label="Files"
          count={files.count}
          countIsLowerBound={files.isLowerBound}
          isLoading={files.isLoading}
          onClick={() => navigate("/library/files")}
        />
      </div>

      {/* Declarative entry point — wired identically to the web Library
          landing. */}
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
        onApplied={refreshCounts}
      />
    </div>
  );
}
