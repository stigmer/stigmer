"use client";

import Link from "next/link";
import { useWorkflowNavigation } from "@/domain/workflow/workflow-navigation";
import { useBreadcrumbLabel } from "@stigmer/react";

const SEGMENT_LABELS: Record<string, string> = {
  executions: "Executions",
};

export function WorkflowBreadcrumb() {
  const { currentWorkflowPath } = useWorkflowNavigation();
  const overrideLabel = useBreadcrumbLabel();
  const segments = currentWorkflowPath
    .replace(/^\/workflows\/?/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-1.5 text-sm">
        <li>
          <Link
            href="/workflows"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Workflows
          </Link>
        </li>
        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1;
          const isKnownCategory = segment in SEGMENT_LABELS;

          if (!isLast && !isKnownCategory) return null;

          const label =
            isLast && !isKnownCategory && overrideLabel
              ? overrideLabel
              : (SEGMENT_LABELS[segment] ?? segment);

          return (
            <li key={segment} className="flex items-center gap-1.5">
              <span
                className="text-muted-foreground-subtle"
                aria-hidden="true"
              >
                /
              </span>
              {isLast ? (
                <span
                  className="font-medium text-foreground"
                  aria-current="page"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={`/workflows/${segments.slice(0, i + 1).join("/")}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
