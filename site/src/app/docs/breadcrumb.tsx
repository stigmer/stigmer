import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BreadcrumbItem } from "@/lib/breadcrumb";
import { cn } from "@/lib/utils";

/**
 * Breadcrumb renderer for docs pages, replacing Fumadocs' built-in
 * `PageBreadcrumb` so the trail can be computed server-side by
 * `buildBreadcrumbItems` (tab-aware root, no duplicate root-folder crumb).
 *
 * The markup and classes mirror the Fumadocs default exactly — this component
 * changes where the items come from, not how they look.
 */
export function DocsBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-sm text-fd-muted-foreground">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const className = cn("truncate", isLast && "text-fd-primary font-medium");

        return (
          <Fragment key={i}>
            {i !== 0 && <ChevronRight className="size-3.5 shrink-0" />}
            {item.url ? (
              <Link
                href={item.url}
                className={cn(className, "transition-opacity hover:opacity-80")}
              >
                {item.name}
              </Link>
            ) : (
              <span className={className}>{item.name}</span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
