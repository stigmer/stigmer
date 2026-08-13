"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { ProviderStandingEntry } from "@stigmer/protos/ai/stigmer/platform/providerstanding/v1/io_pb";
import { Button } from "../button/index.js";
import { ProviderStandingAccessNotice } from "./ProviderStandingAccessNotice.js";
import { useProviderStanding } from "./useProviderStanding.js";

/** Props for {@link ProviderStandingConsole}. */
export interface ProviderStandingConsoleProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

// BigInt literals (0n) require an ES2020 target, which not every consuming
// app's tsconfig guarantees — the constructor form is target-agnostic (the
// cursor-account-format precedent).
const ZERO = BigInt(0);

/**
 * A probe verdict older than this is flagged stale — the probe-silence
 * alert's UI twin: the probe runs hourly and the alert fires at 3h (the
 * 60m interval plus generous grace), so the console goes amber on the
 * same clock operators are paged on.
 */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Display metadata for the probe's closed status vocabulary (the
 * lowercase labels StandingStatus persists). An unknown future label
 * degrades to a muted badge showing the raw label — the wire contract is
 * a string precisely so consoles never fail to decode a new status.
 */
const STATUS_DISPLAY: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  healthy: { label: "Healthy", tone: "ok" },
  platform_billing: { label: "Billing rejected", tone: "warn" },
  platform_auth: { label: "Auth rejected", tone: "warn" },
  unclassified_error: { label: "Erroring", tone: "warn" },
  unreachable: { label: "Unreachable", tone: "warn" },
  not_configured: { label: "Not configured", tone: "muted" },
};

/**
 * The platform-operator console page for provider standing: one card per
 * platform LLM provider account with the latest canary-probe verdict —
 * status, round-trip latency, upstream HTTP status, a bounded error
 * summary, and when the probe last ran (flagged when stale).
 *
 * Read-only by design: the detection core (hourly probe, standing store,
 * degraded/silence alerts) lives server-side; this surface only makes it
 * visible where operators already look. Requires
 * `can_view_provider_standing` on `platform:stigmer` — non-operators see
 * the designed access notice.
 *
 * @example
 * ```tsx
 * <ProviderStandingConsole />
 * ```
 */
export function ProviderStandingConsole({ className }: ProviderStandingConsoleProps) {
  const { standing, isLoading, isRefetching, error, refetch } = useProviderStanding();

  if (isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="stg:h-16 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        ))}
      </div>
    );
  }

  if (error) {
    // A non-operator landing here is expected (the route is reachable by
    // URL) — show the designed access notice, not a raw RPC error.
    if (isPermissionDenied(error)) {
      return <ProviderStandingAccessNotice className={className} />;
    }
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  const providers = standing?.providers ?? [];

  return (
    <div className={cn("stg:space-y-3", className)}>
      <div className="stg:flex stg:items-center stg:justify-between">
        <p className="stg:text-xs stg:text-muted-foreground">
          Latest canary verdict per platform provider account, probed hourly.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={isRefetching}
        >
          {isRefetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {providers.length === 0 ? (
        <p className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
          No probe verdicts recorded yet — the standing probe has not
          completed a pass since this deployment came up.
        </p>
      ) : (
        <ul className="stg:m-0 stg:grid stg:list-none stg:gap-2 stg:p-0 sm:stg:grid-cols-2">
          {providers.map((entry) => (
            <StandingCard key={entry.provider} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StandingCard({ entry }: { readonly entry: ProviderStandingEntry }) {
  const display = STATUS_DISPLAY[entry.status] ?? {
    label: entry.status || "unknown",
    tone: "muted" as const,
  };
  const stale = isStale(entry.checkedAt);

  return (
    <li className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-3">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-2">
        <span className="stg:text-sm stg:font-semibold stg:capitalize stg:text-foreground">
          {entry.provider}
        </span>
        <StatusBadge tone={display.tone} label={display.label} />
      </div>

      <dl className="stg:mt-2 stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1 stg:text-xs stg:text-muted-foreground">
        {entry.latencyMs > ZERO && (
          <div className="stg:flex stg:gap-1">
            <dt>Latency</dt>
            <dd className="stg:m-0 stg:text-foreground">{`${entry.latencyMs}ms`}</dd>
          </div>
        )}
        {entry.httpStatus > 0 && (
          <div className="stg:flex stg:gap-1">
            <dt>HTTP</dt>
            <dd className="stg:m-0 stg:text-foreground">{entry.httpStatus}</dd>
          </div>
        )}
        <div className="stg:flex stg:gap-1">
          <dt>Probed</dt>
          <dd
            className={cn(
              "stg:m-0",
              stale ? "stg:font-medium stg:text-destructive" : "stg:text-foreground",
            )}
          >
            {formatProbeTime(entry.checkedAt)}
            {stale ? " — stale" : ""}
          </dd>
        </div>
      </dl>

      {entry.errorSummary && (
        <p className="stg:mt-2 stg:break-words stg:rounded stg:bg-muted-subtle stg:px-2 stg:py-1 stg:text-[11px] stg:text-muted-foreground">
          {entry.errorSummary}
        </p>
      )}
    </li>
  );
}

/**
 * Small tonal status badge — the cursor-accounts StateBadge shape, local
 * to this module (the two operator surfaces evolve independently).
 */
function StatusBadge({
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

function isStale(ts: Timestamp | undefined): boolean {
  if (!ts || ts.seconds === ZERO) return true;
  return Date.now() - Number(ts.seconds) * 1000 > STALE_AFTER_MS;
}

/** Proto Timestamp to a compact local date-time (e.g. "Jul 22, 14:05"). */
function formatProbeTime(ts: Timestamp | undefined): string {
  if (!ts || ts.seconds === ZERO) {
    return "never";
  }
  return new Date(Number(ts.seconds) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
