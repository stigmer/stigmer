import Link from "next/link";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Badge } from "@/components/ui/badge";
import { Bot, Globe } from "lucide-react";
import { formatRelativeTime, toDate } from "@/lib/time";

interface AgentSearchCardProps {
  result: SearchResult;
}

export function AgentSearchCard({ result }: AgentSearchCardProps) {
  const isPublic =
    result.visibility === ApiResourceVisibility.visibility_public;

  return (
    <Link href={`/agents/${result.id}`} className="group block">
      <div className="bg-card text-card-foreground hover:bg-accent/50 flex flex-col rounded-xl border p-4 transition-colors">
        {/* Header: icon + name */}
        <div className="flex items-start gap-3">
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Bot className="text-muted-foreground size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {result.name}
              </span>
              {isPublic && (
                <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
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
      </div>
    </Link>
  );
}
