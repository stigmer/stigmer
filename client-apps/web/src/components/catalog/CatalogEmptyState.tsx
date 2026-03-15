import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Bot, FileCode2, Server, SearchX } from "lucide-react";

function kindMeta(kind: ApiResourceKind) {
  switch (kind) {
    case ApiResourceKind.agent:
      return { Icon: Bot, label: "agents" };
    case ApiResourceKind.skill:
      return { Icon: FileCode2, label: "skills" };
    case ApiResourceKind.mcp_server:
      return { Icon: Server, label: "MCP servers" };
    default:
      return { Icon: Bot, label: "resources" };
  }
}

interface CatalogEmptyStateProps {
  kind: ApiResourceKind;
  hasQuery: boolean;
}

export function CatalogEmptyState({ kind, hasQuery }: CatalogEmptyStateProps) {
  const { Icon, label } = kindMeta(kind);

  if (hasQuery) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <SearchX className="text-muted-foreground/40 mb-3 size-10" />
        <p className="text-sm font-medium">No matching {label}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Try a different search term or clear the filter.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Icon className="text-muted-foreground/40 mb-3 size-10" />
      <p className="text-sm font-medium">No {label} yet</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {label.charAt(0).toUpperCase() + label.slice(1)} you create or have
        access to will appear here.
      </p>
    </div>
  );
}
