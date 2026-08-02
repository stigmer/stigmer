import type { StatusPhase } from "../resource-workbench/types.js";

/**
 * Display helpers for provider message templates — the template
 * counterpart of {@link ChannelProviderPresentation}'s module split:
 * `ChannelTemplatesDialog` renders, this module decides how a
 * provider-verbatim template projects onto the SDK's display
 * vocabulary. Pure functions, one writer each.
 */

/**
 * Map a provider-verbatim template status onto a {@link StatusPhase}
 * for `StatusBadge` coloring.
 *
 * The wire carries the provider's own vocabulary, never a Stigmer enum
 * (DD-003 D6) — so the caller renders the verbatim status string as the
 * badge label and uses this phase only for the color. WhatsApp's
 * observed set exceeds the documented five (IN_APPEAL, LIMIT_EXCEEDED,
 * PENDING_DELETION, DELETED occur, and Meta can add more), so unknown
 * statuses deliberately land on `draft` — a neutral tone that renders
 * the provider's word without claiming to understand it.
 */
export function templateStatusPhase(status: string): StatusPhase {
  switch (status) {
    case "APPROVED":
      return "ready";
    case "PENDING":
    case "IN_APPEAL":
      return "pending";
    case "PAUSED":
    case "LIMIT_EXCEEDED":
      return "degraded";
    case "REJECTED":
    case "DISABLED":
      return "failed";
    case "PENDING_DELETION":
    case "DELETED":
      return "disabled";
    default:
      return "draft";
  }
}

/** One segment of a template body: literal text or a `{{...}}` placeholder. */
export interface TemplateBodySegment {
  readonly kind: "text" | "placeholder";
  /** The verbatim slice, braces included for placeholders (`"{{1}}"`). */
  readonly value: string;
}

/**
 * The provider's placeholder shape: `{{1}}` (positional) or
 * `{{customer_name}}` (named). Single braces and unbalanced braces are
 * literal text — the provider would not have accepted them either.
 */
const PLACEHOLDER = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;

/**
 * Split a template body into text and placeholder segments so the
 * placeholders — the parts the agent fills at send time — can render
 * visually distinct from the literal copy.
 *
 * The concatenation of all segment values is always the input,
 * verbatim: this function classifies, it never rewrites.
 */
export function splitTemplateBody(
  body: string,
): readonly TemplateBodySegment[] {
  const segments: TemplateBodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: body.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "placeholder", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", value: body.slice(lastIndex) });
  }
  return segments;
}
