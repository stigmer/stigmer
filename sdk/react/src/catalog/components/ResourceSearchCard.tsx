import type { ReactNode } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Bot, FileCode2, Server, Globe, Box } from "lucide-react";

import { cn } from "@stigmer/theme";

import { Badge } from "../../internal/badge";
import { formatRelativeTime, toDate } from "../internal/time";

const KIND_ICON: Record<number, ReactNode> = {
  [ApiResourceKind.agent]: <Bot className="text-muted-foreground size-4" />,
  [ApiResourceKind.skill]: <FileCode2 className="text-muted-foreground size-4" />,
  [ApiResourceKind.mcp_server]: <Server className="text-muted-foreground size-4" />,
};

const FALLBACK_ICON = <Box className="text-muted-foreground size-4" />;

export interface ResourceSearchCardProps {
  /** The search result to display. */
  result: SearchResult;
  /** When provided, the card renders as an `<a>` element with this URL. */
  href?: string;
  /** Click handler for SPA navigation or custom actions. */
  onClick?: () => void;
  /** Override the auto-detected icon derived from `result.kind`. */
  icon?: ReactNode;
  /** Additional CSS class names on the root element. */
  className?: string;
}

/**
 * A card component for displaying any Stigmer resource search result
 * (agent, skill, MCP server) in a grid catalog layout.
 *
 * Auto-selects the icon based on `result.kind`. Renders as an `<a>` tag
 * when `href` is provided, otherwise as a `<div>`.
 */
export function ResourceSearchCard({
  result,
  href,
  onClick,
  icon,
  className,
}: ResourceSearchCardProps) {
  const isPublic =
    result.visibility === ApiResourceVisibility.visibility_public;

  const resolvedIcon = icon ?? KIND_ICON[result.kind] ?? FALLBACK_ICON;

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
        <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
          {resolvedIcon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {result.name}
            </span>
            {isPublic && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                <Globe className="size-2.5" />
                Public
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {result.qualifiedSlug}
          </p>
        </div>
      </div>

      {/* Description */}
      {result.description && (
        <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed">
          {result.description}
        </p>
      )}

      {/* Footer: tags + timestamp */}
      <div className="mt-3 flex items-end justify-between gap-2">
        {result.tags.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1">
            {result.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
            {result.tags.length > 3 && (
              <span className="text-muted-foreground self-center text-[10px]">
                +{result.tags.length - 3}
              </span>
            )}
          </div>
        ) : (
          <div />
        )}
        {result.createdAt && (
          <time
            dateTime={toDate(result.createdAt)?.toISOString() ?? ""}
            className="text-muted-foreground shrink-0 text-[10px]"
          >
            {formatRelativeTime(result.createdAt)}
          </time>
        )}
      </div>
    </Tag>
  );
}
