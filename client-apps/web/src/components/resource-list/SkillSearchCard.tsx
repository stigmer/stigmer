import Link from "next/link";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Badge } from "@/components/ui/badge";
import { FileCode2, Globe, ChevronRight } from "lucide-react";
import { formatRelativeTime, toDate } from "@/lib/time";

interface SkillSearchCardProps {
  result: SearchResult;
}

export function SkillSearchCard({ result }: SkillSearchCardProps) {
  const isPublic =
    result.visibility === ApiResourceVisibility.visibility_public;

  return (
    <Link href={`/skills/${result.id}`} className="block">
      <div className="hover:bg-accent/50 flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors">
        {/* Icon */}
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
          <FileCode2 className="text-muted-foreground size-4" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{result.name}</span>
            {isPublic && (
              <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                <Globe className="size-2.5" />
                Public
              </Badge>
            )}
            {result.tags.length > 0 && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {result.tags[0]}
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="truncate font-mono text-[11px]">
              {result.qualifiedSlug}
            </span>
            {result.description && (
              <>
                <span className="text-border">|</span>
                <span className="truncate">{result.description}</span>
              </>
            )}
          </div>
        </div>

        {/* Timestamp + chevron */}
        <div className="flex shrink-0 items-center gap-2">
          {result.createdAt && (
            <time
              dateTime={toDate(result.createdAt)?.toISOString() ?? ""}
              className="text-muted-foreground text-[11px]"
            >
              {formatRelativeTime(result.createdAt)}
            </time>
          )}
          <ChevronRight className="text-muted-foreground size-4" />
        </div>
      </div>
    </Link>
  );
}
