"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  History,
  Play,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAgentQueryService } from "@stigmer/agent-ui";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useSessionPage } from "@/hooks/sessions/useSessionPage";
import { formatRelativeTime, toDate } from "@/lib/time";

const AGENT_FILTER_KEY = ["agents", "filter-options"] as const;
const AGENT_FILTER_PAGE_SIZE = 100;

export default function SessionsPage() {
  const [page, setPage] = useState(1);
  const [agentId, setAgentId] = useState("");

  const { sessions, totalPages, isLoading, error, refetch } = useSessionPage({
    page,
    agentId: agentId || undefined,
  });

  const org = useActiveOrgSlug();
  const agentService = useAgentQueryService();

  const { data: agentData } = useQuery({
    queryKey: [...AGENT_FILTER_KEY, org],
    queryFn: () =>
      agentService.search({
        query: "",
        org,
        page: { num: 1, size: AGENT_FILTER_PAGE_SIZE },
      }),
    enabled: !!org,
  });

  const agents = agentData?.entries ?? [];

  const handleAgentChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAgentId(e.target.value);
      setPage(1);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setAgentId("");
    setPage(1);
  }, []);

  const hasActiveFilter = !!agentId;

  return (
    <>
      <TopBar
        title="Sessions"
        description="Browse and manage agent sessions"
        actions={
          <Link
            href="/run"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            <Play className="size-3.5" />
            Run Agent
          </Link>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 pb-4">
        <div className="flex items-center gap-2">
          <label
            htmlFor="agent-filter"
            className="text-muted-foreground text-sm"
          >
            Agent
          </label>
          <select
            id="agent-filter"
            value={agentId}
            onChange={handleAgentChange}
            className="border-border bg-background text-foreground focus:border-ring focus:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus:ring-3"
          >
            <option value="">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name || agent.slug}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && <ErrorMessage error={error} retry={refetch} />}

      {/* Loading state */}
      {isLoading && !error && (
        <div className="space-y-0">
          <div className="border-border flex h-9 items-center border-b px-3">
            <div className="bg-muted/60 h-3 w-24 animate-pulse rounded" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-border flex items-center gap-6 border-b px-3 py-2.5"
            >
              <div className="bg-muted/60 h-4 w-48 animate-pulse rounded" />
              <div className="bg-muted/60 h-4 w-28 animate-pulse rounded" />
              <div className="bg-muted/60 h-4 w-20 animate-pulse rounded" />
              <div className="bg-muted/60 h-4 w-20 animate-pulse rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no sessions at all */}
      {!isLoading && !error && sessions.length === 0 && !hasActiveFilter && (
        <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed py-16">
          <History className="text-muted-foreground/40 size-10" />
          <div className="text-center">
            <p className="text-sm font-medium">No sessions yet</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Run an agent to create your first session.
            </p>
          </div>
          <Link
            href="/run"
            className="border-border bg-background hover:bg-muted mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors"
          >
            <Play className="size-3.5" />
            Run Agent
          </Link>
        </div>
      )}

      {/* Empty state — filter produces no results */}
      {!isLoading && !error && sessions.length === 0 && hasActiveFilter && (
        <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed py-16">
          <History className="text-muted-foreground/40 size-10" />
          <p className="text-sm font-medium">No sessions found</p>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}

      {/* Data table */}
      {!isLoading && !error && sessions.length > 0 && (
        <>
          <Table aria-label="Sessions">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Session</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => {
                const id = session.metadata?.id ?? "";
                const displayName =
                  session.spec?.subject ||
                  session.metadata?.name ||
                  "Untitled session";
                const agentInstanceId =
                  session.spec?.agentInstanceId || "\u2014";
                const createdAt = session.status?.audit?.specAudit?.createdAt;
                const updatedAt = session.status?.audit?.specAudit?.updatedAt;

                return (
                  <TableRow key={id}>
                    <TableCell>
                      <Link
                        href={`/sessions/${id}`}
                        className="hover:text-primary flex items-center gap-2 transition-colors"
                      >
                        <MessageSquare className="text-muted-foreground size-4 shrink-0" />
                        <span className="truncate font-medium">
                          {displayName}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {agentInstanceId}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {createdAt ? (
                        <time
                          dateTime={toDate(createdAt)?.toISOString() ?? ""}
                          title={toDate(createdAt)?.toLocaleString() ?? ""}
                        >
                          {formatRelativeTime(createdAt)}
                        </time>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {updatedAt ? (
                        <time
                          dateTime={toDate(updatedAt)?.toISOString() ?? ""}
                          title={toDate(updatedAt)?.toLocaleString() ?? ""}
                        >
                          {formatRelativeTime(updatedAt)}
                        </time>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-muted-foreground text-sm">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Go to previous page"
                >
                  <ChevronLeft className="size-3.5" data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  aria-label="Go to next page"
                >
                  Next
                  <ChevronRight className="size-3.5" data-icon="inline-end" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
