"use client";

import { cn } from "@stigmer/theme";
import type { McpServerDefinitionDrift } from "./useMcpServerDefinitionDrift.js";
import type { DriftFieldId } from "./internal/definitionDrift.js";

/** Props for {@link DefinitionDriftNotice}. */
export interface DefinitionDriftNoticeProps {
  /**
   * The detected drift from {@link useMcpServerDefinitionDrift}, or
   * `null`. The notice renders `null` when there is no drift.
   */
  readonly drift: McpServerDefinitionDrift | null;
  /** Applies the marketplace configuration and re-runs discovery. */
  readonly onRefresh: () => void;
  /** `true` while the refresh (update + re-discovery) is in flight. */
  readonly isRefreshing: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/** Human-readable labels for the drifted field groups. */
const DRIFT_FIELD_LABELS: Record<DriftFieldId, string> = {
  transport: "connection type",
  endpoint: "endpoint URL",
  headers: "request headers",
  queryParams: "query parameters",
  timeout: "request timeout",
  command: "launch command",
  workingDirectory: "working directory",
  environmentVariables: "environment variables",
  authentication: "authentication",
};

/**
 * Tells the owner of an org-owned MCP server that its connection-defining
 * configuration differs from the current marketplace definition, and
 * offers a one-click refresh (stigmer/stigmer#228).
 *
 * Without this notice, a server copied before a template fix is stranded
 * forever: the user sees only downstream symptoms ("Token expired", 401s)
 * with no indication that the root cause is a stale definition and no
 * recovery path short of hand-editing YAML. This surfaces the actual
 * state and pairs it with the action that fixes it (Nielsen: visibility
 * of system status; error recovery).
 *
 * The copy says the configuration **differs** — never "was updated" —
 * because the marketplace counterpart is matched by slug, and a
 * hand-made server that happens to share a marketplace name must not be
 * told a false history. Naming the differing fields keeps the claim
 * verifiable, and the refresh explicitly promises what it preserves.
 *
 * Self-gating: renders `null` unless drift was detected. Callers render
 * it unconditionally next to the other connection notices, mirroring
 * {@link OAuthRequiredNotice}.
 *
 * All visual properties flow through `--stgm-*` design tokens. No
 * Console-specific dependencies — safe for platform-builder embedding.
 */
export function DefinitionDriftNotice({
  drift,
  onRefresh,
  isRefreshing,
  className,
}: DefinitionDriftNoticeProps) {
  if (!drift) return null;

  const fieldList = drift.changedFields
    .map((id) => DRIFT_FIELD_LABELS[id])
    .join(", ");

  return (
    <div
      role="status"
      className={cn(
        "stg:bg-muted-subtle stg:text-muted-foreground stg:flex stg:items-start stg:gap-2.5 stg:rounded-lg stg:border stg:border-transparent stg:px-4 stg:py-3",
        className,
      )}
    >
      <RefreshIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0" />
      <div className="stg:flex-1">
        <p className="stg:text-xs stg:leading-relaxed">
          This server&apos;s configuration differs from the current
          marketplace definition ({fieldList}). Refreshing applies the
          marketplace configuration and re-runs discovery — your enabled
          tools and approval pins are kept.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          data-cursor-target="definition-drift-refresh"
          className="stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover stg:mt-2 stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-[11px] stg:font-medium stg:disabled:opacity-60"
        >
          {isRefreshing ? "Refreshing…" : "Refresh configuration"}
        </button>
      </div>
    </div>
  );
}

function RefreshIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
      <path d="M13.5 2v3h-3" />
    </svg>
  );
}
