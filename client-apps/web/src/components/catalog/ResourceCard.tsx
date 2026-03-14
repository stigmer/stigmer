import Link from "next/link";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, FileCode2, Server, ChevronRight, Globe } from "lucide-react";
import { formatRelativeTime, toDate } from "@/lib/time";

function kindIconElement(kind: ApiResourceKind) {
  const className = "size-4 shrink-0 text-muted-foreground";
  switch (kind) {
    case ApiResourceKind.agent:
      return <Bot className={className} />;
    case ApiResourceKind.skill:
      return <FileCode2 className={className} />;
    case ApiResourceKind.mcp_server:
      return <Server className={className} />;
    default:
      return <Bot className={className} />;
  }
}

function kindHref(kind: ApiResourceKind, id: string): string {
  switch (kind) {
    case ApiResourceKind.agent:
      return `/agents/${id}`;
    case ApiResourceKind.skill:
      return `/skills/${id}`;
    case ApiResourceKind.mcp_server:
      return `/mcp-servers/${id}`;
    default:
      return `/agents/${id}`;
  }
}

interface ResourceCardProps {
  result: SearchResult;
}

export function ResourceCard({ result }: ResourceCardProps) {
  const href = kindHref(result.kind, result.id);
  const isPublic = result.visibility === ApiResourceVisibility.visibility_public;

  return (
    <Link href={href} className="block">
      <Card size="sm" className="transition-colors hover:bg-accent/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {kindIconElement(result.kind)}
            <span className="truncate">{result.name}</span>
            {isPublic && (
              <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                <Globe className="size-2.5" />
                Public
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            <span className="flex items-center gap-3">
              <span className="truncate font-mono text-xs">
                {result.qualifiedSlug}
              </span>
              {result.createdAt && (
                <time
                  dateTime={toDate(result.createdAt)?.toISOString() ?? ""}
                  className="shrink-0"
                >
                  {formatRelativeTime(result.createdAt)}
                </time>
              )}
            </span>
          </CardDescription>
          <CardAction>
            <ChevronRight className="size-4 text-muted-foreground" />
          </CardAction>
        </CardHeader>
        {(result.description || result.tags.length > 0) && (
          <CardContent>
            <div className="space-y-2">
              {result.description && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {result.description}
                </p>
              )}
              {result.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {result.tags.slice(0, 5).map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px]"
                    >
                      {tag}
                    </Badge>
                  ))}
                  {result.tags.length > 5 && (
                    <span className="self-center text-[10px] text-muted-foreground">
                      +{result.tags.length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </Link>
  );
}
