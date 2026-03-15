import Link from "next/link";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card";
import { MessageSquare, ChevronRight } from "lucide-react";
import { formatRelativeTime, toDate } from "@/lib/time";

interface SessionCardProps {
  session: Session;
}

export function SessionCard({ session }: SessionCardProps) {
  const id = session.metadata?.id ?? "";
  const displayName =
    session.spec?.subject || session.metadata?.name || "Untitled session";

  const createdAt = session.status?.audit?.specAudit?.createdAt;
  const updatedAt = session.status?.audit?.specAudit?.updatedAt;

  return (
    <Link href={`/sessions/${id}`} className="block">
      <Card size="sm" className="hover:bg-accent/50 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{displayName}</span>
          </CardTitle>
          <CardDescription>
            <span className="flex items-center gap-3">
              {createdAt && (
                <time dateTime={toDate(createdAt)?.toISOString() ?? ""}>
                  {formatRelativeTime(createdAt)}
                </time>
              )}
              {updatedAt && createdAt && (
                <span className="text-muted-foreground/60">
                  updated {formatRelativeTime(updatedAt)}
                </span>
              )}
            </span>
          </CardDescription>
          <CardAction>
            <ChevronRight className="text-muted-foreground size-4" />
          </CardAction>
        </CardHeader>
      </Card>
    </Link>
  );
}
