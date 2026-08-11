"use client";

import { memo, useMemo } from "react";
import type { JsonObject } from "@bufbuild/protobuf";

export interface BranchBadgeProps {
  readonly kindString: string;
  readonly config: JsonObject;
}

/**
 * Decorative badge rendered below branch/container nodes in design mode.
 *
 * Shows contextual metadata:
 * - fork: branch name chips + join policy
 * - try_catch: catch handler indicator
 * - for_each: iteration info (concurrency, error policy)
 *
 * @since T09 (Branch Management UX)
 */
export const BranchBadge = memo(function BranchBadge({
  kindString,
  config,
}: BranchBadgeProps) {
  const raw = config as Record<string, unknown>;

  if (kindString === "fork") {
    return <ForkBadge config={raw} />;
  }

  if (kindString === "try_catch") {
    return <TryCatchBadge config={raw} />;
  }

  if (kindString === "for_each") {
    return <ForEachBadge config={raw} />;
  }

  return null;
});

// ---------------------------------------------------------------------------

function ForkBadge({ config }: { config: Record<string, unknown> }) {
  const branches = useMemo(() => {
    const raw = config.branches;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((b): b is Record<string, unknown> => b != null && typeof b === "object")
      .map((b) => (b.name as string) || "");
  }, [config.branches]);

  const compete = config.compete === true;

  if (branches.length === 0) return null;

  const maxVisible = 3;
  const visible = branches.slice(0, maxVisible);
  const overflow = branches.length > maxVisible ? branches.length - maxVisible : 0;

  return (
    <div className="stg:absolute stg:left-1/2 stg:-translate-x-1/2 stg:top-full stg:mt-1 stg:flex stg:items-center stg:gap-0.5 stg:pointer-events-none">
      {visible.map((name) => (
        <span
          key={name}
          className="stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)] stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:px-1 stg:py-px stg:text-[8px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)] stg:whitespace-nowrap"
        >
          {name}
        </span>
      ))}
      {overflow > 0 && (
        <span className="stg:text-[8px] stg:text-[var(--stgm-muted-foreground,#737373)]">
          +{overflow}
        </span>
      )}
      {compete && (
        <span className="stg:ml-0.5 stg:rounded stg:bg-[var(--stgm-chart-amber,#f59e0b)]/10 stg:border stg:border-[var(--stgm-chart-amber,#f59e0b)]/30 stg:px-1 stg:py-px stg:text-[8px] stg:font-medium stg:text-[var(--stgm-chart-amber,#f59e0b)] stg:whitespace-nowrap">
          race
        </span>
      )}
    </div>
  );
}

function TryCatchBadge({ config }: { config: Record<string, unknown> }) {
  const catchBlock = config.catch;
  if (!catchBlock || typeof catchBlock !== "object") return null;

  const asVar = (catchBlock as Record<string, unknown>).as as string | undefined;

  return (
    <div className="stg:absolute stg:left-1/2 stg:-translate-x-1/2 stg:top-full stg:mt-1 stg:flex stg:items-center stg:gap-0.5 stg:pointer-events-none">
      <span className="stg:rounded stg:bg-[var(--stgm-destructive,#ef4444)]/10 stg:border stg:border-[var(--stgm-destructive,#ef4444)]/20 stg:px-1 stg:py-px stg:text-[8px] stg:font-medium stg:text-[var(--stgm-destructive,#ef4444)] stg:whitespace-nowrap">
        catch: {asVar || "error"}
      </span>
    </div>
  );
}

function ForEachBadge({ config }: { config: Record<string, unknown> }) {
  const parallelism = (config.max_parallelism as number) || 0;
  const onError = (config.on_error as string) || "";

  const parts: string[] = [];
  if (parallelism > 0) {
    parts.push(`×${parallelism}`);
  } else {
    parts.push("seq");
  }

  const showErrorPolicy = parallelism > 0 && onError && onError !== "FOR_EACH_FAIL_FAST" && onError !== "FOR_EACH_ERROR_POLICY_UNSPECIFIED";

  return (
    <div className="stg:absolute stg:left-1/2 stg:-translate-x-1/2 stg:top-full stg:mt-1 stg:flex stg:items-center stg:gap-0.5 stg:pointer-events-none">
      <span className="stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)] stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:px-1 stg:py-px stg:text-[8px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)] stg:whitespace-nowrap">
        ↻ {parts.join(" ")}
      </span>
      {showErrorPolicy && (
        <span className="stg:rounded stg:bg-[var(--stgm-chart-amber,#f59e0b)]/10 stg:border stg:border-[var(--stgm-chart-amber,#f59e0b)]/30 stg:px-1 stg:py-px stg:text-[8px] stg:font-medium stg:text-[var(--stgm-chart-amber,#f59e0b)] stg:whitespace-nowrap">
          {onError === "FOR_EACH_CONTINUE" ? "continue" : "skip"}
        </span>
      )}
    </div>
  );
}
