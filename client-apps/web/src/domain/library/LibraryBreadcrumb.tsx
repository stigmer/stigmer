"use client";

import Link from "next/link";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { useBreadcrumbLabel } from "./LibraryBreadcrumbContext";

const SEGMENT_LABELS: Record<string, string> = {
  agents: "Agents",
  skills: "Skills",
  "mcp-servers": "MCP Servers",
};

export function LibraryBreadcrumb() {
  const { currentLibraryPath } = useLibraryNavigation();
  const overrideLabel = useBreadcrumbLabel();
  const segments = currentLibraryPath.replace(/^\/library\/?/, "").split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-1.5 text-sm">
        <li>
          <Link
            href="/library"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Library
          </Link>
        </li>
        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1;
          const isKnownCategory = segment in SEGMENT_LABELS;

          // Skip intermediate segments (e.g. the [org] in /skills/[org]/[slug])
          // that are not a known category and not the final segment.
          if (!isLast && !isKnownCategory) return null;

          const label =
            isLast && !isKnownCategory && overrideLabel
              ? overrideLabel
              : (SEGMENT_LABELS[segment] ?? segment);

          return (
            <li key={segment} className="flex items-center gap-1.5">
              <span className="text-muted-foreground-subtle" aria-hidden="true">/</span>
              {isLast ? (
                <span className="text-foreground font-medium" aria-current="page">
                  {label}
                </span>
              ) : (
                <Link
                  href={`/library/${segments.slice(0, i + 1).join("/")}`}
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
