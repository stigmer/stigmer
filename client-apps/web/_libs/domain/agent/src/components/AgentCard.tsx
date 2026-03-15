import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Bot, Globe, Server, FileCode2, Users } from "lucide-react";

import { cn } from "@stigmer/theme";

import { Badge } from "../internal/badge";

interface AgentCardProps {
  agent: Agent;
  onClick?: () => void;
  href?: string;
  className?: string;
}

function AgentCard({ agent, onClick, href, className }: AgentCardProps) {
  const meta = agent.metadata;
  const spec = agent.spec;
  const isPublic = meta?.visibility === ApiResourceVisibility.visibility_public;
  const qualifiedSlug = meta?.org ? `${meta.org}/${meta.slug}` : meta?.slug;

  const mcpServerCount = spec?.mcpServerUsages?.length ?? 0;
  const skillCount = spec?.skillRefs?.length ?? 0;
  const subAgentCount = spec?.subAgents?.length ?? 0;

  const Tag = href ? "a" : "div";
  const interactive = !!(onClick || href);

  return (
    <Tag
      href={href}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e: React.KeyboardEvent) => {
              if (onClick && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "bg-card text-card-foreground flex flex-col rounded-xl border p-4",
        interactive &&
          "hover:bg-accent/50 focus-visible:ring-ring cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {/* Header: icon + name + visibility */}
      <div className="flex items-start gap-3">
        {spec?.iconUrl ? (
          <img
            src={spec.iconUrl}
            alt=""
            className="size-9 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Bot className="text-muted-foreground size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{meta?.name}</span>
            {isPublic && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                <Globe className="size-2.5" />
                Public
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {qualifiedSlug}
          </p>
        </div>
      </div>

      {/* Description */}
      {spec?.description && (
        <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed">
          {spec.description}
        </p>
      )}

      {/* Stat row: MCP servers, skills, sub-agents */}
      {(mcpServerCount > 0 || skillCount > 0 || subAgentCount > 0) && (
        <div className="text-muted-foreground mt-3 flex items-center gap-3 text-[11px]">
          {mcpServerCount > 0 && (
            <span className="flex items-center gap-1">
              <Server className="size-3" />
              {mcpServerCount}
            </span>
          )}
          {skillCount > 0 && (
            <span className="flex items-center gap-1">
              <FileCode2 className="size-3" />
              {skillCount}
            </span>
          )}
          {subAgentCount > 0 && (
            <span className="flex items-center gap-1">
              <Users className="size-3" />
              {subAgentCount}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {meta?.tags && meta.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {meta.tags.slice(0, 4).map((tag: string) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
          {meta.tags.length > 4 && (
            <span className="text-muted-foreground self-center text-[10px]">
              +{meta.tags.length - 4}
            </span>
          )}
        </div>
      )}
    </Tag>
  );
}

export { AgentCard };
export type { AgentCardProps };
