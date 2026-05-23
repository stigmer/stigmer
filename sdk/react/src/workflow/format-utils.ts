/**
 * Shared formatting utilities for workflow execution metrics.
 *
 * Consolidates formatting logic previously duplicated across
 * WorkflowExecutionViewer, WorkflowExecutionHeader,
 * WorkflowExecutionCostPanel, WorkflowExecutionTaskPanel,
 * and WorkflowExecutionTimelineEvent.
 *
 * @since T05 (Runtime Inspector)
 */

const BIGINT_ZERO = BigInt(0);

/**
 * Formats a duration in milliseconds to a human-readable string.
 *
 * Output examples: `42ms`, `1.3s`, `2m 15s`, `1h 30m`
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

/**
 * Formats a cost in micro-USD (1 USD = 1,000,000 micros) to a dollar string.
 *
 * Output examples: `$0.0012`, `$0.19`, `$4.50`
 *
 * Uses 4 decimal places for sub-cent amounts, 2 otherwise.
 */
export function formatMicroUsd(micros: bigint): string {
  const val = Number(micros) / 1_000_000;
  if (val < 0.01) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

/**
 * Formats a token count to a human-readable abbreviated string.
 *
 * Output examples: `850`, `12.4K`, `1.5M`
 */
export function formatTokenCount(tokens: bigint): string {
  const n = Number(tokens);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Formats a byte count to a human-readable string.
 *
 * Output examples: `128 B`, `4.2 KB`, `1.5 MB`
 */
export function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats an ISO 8601 timestamp to a locale-aware time string (HH:MM:SS).
 */
export function formatTimestamp(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

/**
 * Builds a compact "duration · cost · tokens" chip string from metrics.
 * Omits zero/absent values. Returns `null` if all values are empty.
 *
 * Output example: `1.3s · $0.19 · 12,400 tok`
 */
export function formatMetaChips(opts: {
  readonly durationMs?: number;
  readonly costMicros?: bigint;
  readonly tokens?: bigint;
}): string | null {
  const parts: string[] = [];
  if (opts.durationMs && opts.durationMs > 0) parts.push(formatDuration(opts.durationMs));
  if (opts.costMicros && opts.costMicros > BIGINT_ZERO) parts.push(formatMicroUsd(opts.costMicros));
  if (opts.tokens && opts.tokens > BIGINT_ZERO) parts.push(`${opts.tokens.toLocaleString()} tok`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
