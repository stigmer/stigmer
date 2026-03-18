"use client";

import { useEffect, useMemo, useState } from "react";
import type { UsageMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";

/**
 * Ticks every second while active, returning elapsed milliseconds since
 * `startedAt`. Returns null when inactive or startedAt is empty/invalid.
 */
export function useElapsedMs(
  startedAt: string | undefined,
  active: boolean,
): number | null {
  const startMs = useMemo(() => {
    if (!startedAt) return null;
    const t = new Date(startedAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [startedAt]);

  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (startMs === null || !active) {
      setElapsed(null);
      return;
    }
    setElapsed(Math.max(0, Date.now() - startMs));
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startMs));
    }, 1000);
    return () => clearInterval(id);
  }, [startMs, active]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Guard helpers — determine whether usage data has specific sections
// ---------------------------------------------------------------------------

export function hasModelData(usage: UsageMetrics): boolean {
  return usage.primaryModel !== "" || usage.primaryProvider !== "";
}

export function hasTokenData(usage: UsageMetrics): boolean {
  return usage.totalTokens > 0 || usage.promptTokens > 0;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
