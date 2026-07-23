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
        "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "ok" && "bg-accent text-primary",
        tone === "warn" && "bg-muted-subtle text-destructive",
        tone === "muted" && "bg-muted-subtle text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
