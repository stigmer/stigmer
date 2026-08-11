import { cn } from "@stigmer/theme";

/**
 * Small tonal status badge shared by the cursor-accounts surfaces
 * (account rows, coverage table cells). Internal to the module.
 */
export function StateBadge({
  tone,
  label,
}: {
  readonly tone: "ok" | "warn" | "muted";
  readonly label: string;
}) {
  return (
    <span
      className={cn(
        "stg:inline-block stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium",
        tone === "ok" && "stg:bg-accent stg:text-primary",
        tone === "warn" && "stg:bg-muted-subtle stg:text-destructive",
        tone === "muted" && "stg:bg-muted-subtle stg:text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
