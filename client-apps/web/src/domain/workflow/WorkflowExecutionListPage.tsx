"use client";

import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { WorkflowExecutionPhaseBadge, useWorkflowExecutionList } from "@stigmer/react";
import { timestampDate } from "@bufbuild/protobuf/wkt";

export function WorkflowExecutionListPage() {
  const router = useRouter();
  const { executions, isLoading, error } = useWorkflowExecutionList({
    pageSize: 50,
  });

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">
          Workflow Executions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All workflow executions across your organization.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
        </div>
      )}

      {error && (
        <div className="py-8 text-center text-sm text-destructive">
          Failed to load executions
        </div>
      )}

      {!isLoading && !error && executions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Activity className="mb-3 size-10" aria-hidden="true" />
          <p className="text-sm font-medium">No executions yet</p>
          <p className="mt-1 text-xs">
            Workflow executions will appear here once workflows are run.
          </p>
        </div>
      )}

      {!isLoading && !error && executions.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Phase
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Started
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {executions.map((exec) => {
                const startedAt = exec.status?.audit?.specAudit?.createdAt;
                return (
                  <tr
                    key={exec.metadata?.id}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer transition-colors hover:bg-muted/30"
                    onClick={() => {
                      if (exec.metadata?.id) {
                        router.push(`/workflows/executions/${exec.metadata.id}`);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && exec.metadata?.id) {
                        router.push(`/workflows/executions/${exec.metadata.id}`);
                      }
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      {exec.metadata?.name || exec.metadata?.slug || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {exec.status?.phase != null ? (
                        <WorkflowExecutionPhaseBadge
                          phase={exec.status.phase}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {startedAt
                        ? timestampDate(startedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
