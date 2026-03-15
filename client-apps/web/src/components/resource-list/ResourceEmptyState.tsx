import { Bot, FileCode2, Server, SearchX } from "lucide-react";

type ResourceKindLabel = "agents" | "skills" | "MCP servers";

function kindMeta(kind: ResourceKindLabel) {
  switch (kind) {
    case "agents":
      return { Icon: Bot };
    case "skills":
      return { Icon: FileCode2 };
    case "MCP servers":
      return { Icon: Server };
  }
}

interface ResourceEmptyStateProps {
  kind: ResourceKindLabel;
  hasQuery: boolean;
}

export function ResourceEmptyState({
  kind,
  hasQuery,
}: ResourceEmptyStateProps) {
  if (hasQuery) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <SearchX className="text-muted-foreground/40 mb-3 size-10" />
        <p className="text-sm font-medium">No matching {kind}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Try a different search term or clear the filter.
        </p>
      </div>
    );
  }

  const { Icon } = kindMeta(kind);

  return (
    <div className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Icon className="text-muted-foreground/40 mb-3 size-10" />
      <p className="text-sm font-medium">No {kind} yet</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {kind.charAt(0).toUpperCase() + kind.slice(1)} you create or have access
        to will appear here.
      </p>
    </div>
  );
}
