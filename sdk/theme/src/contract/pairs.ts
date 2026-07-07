/**
 * The declared contrast contract: which token pairs must remain readable,
 * and at what threshold.
 *
 * Every pair is grounded in a real rendering in `@stigmer/react` (the
 * `usage` field cites it). The audit resolves both tokens through the real
 * cascade for every preset × color mode and measures the WCAG 2.1 ratio —
 * this file is the single place where a new "text X renders on surface Y"
 * relationship gets registered.
 *
 * Thresholds:
 * - `text` pairs use WCAG 2.1 AA for normal-size text (4.5:1). SDK chrome
 *   text is predominantly `text-xs`/`text-sm`, so the large-text relaxation
 *   never applies.
 * - `supporting` pairs are deliberately de-emphasized tokens (the `-subtle`
 *   / `-faint` foreground variants). They are held to the AA large-text /
 *   non-text floor (3:1) — below that, "de-emphasized" becomes "invisible".
 * - `surface` pairs have no WCAG-defined threshold. They are measured as
 *   OKLCH lightness delta and asserted against SURFACE_MIN_DELTA_L.
 */

export const TEXT_MIN_RATIO = 4.5;
export const SUPPORTING_TEXT_MIN_RATIO = 3.0;

/**
 * Minimum OKLCH lightness separation for adjacent surfaces that carry no
 * border (e.g. the user message bubble on the thread background). OKLCH L
 * is perceptually uniform, so one number works for both modes; 0.045 keeps
 * the current light-mode card/page relationship comfortably legal while
 * flagging fills that melt into the page.
 */
export const SURFACE_MIN_DELTA_L = 0.045;

export type PairKind = "text" | "supporting" | "surface";

export interface ContrastPair {
  /** Foreground token (text or fill being read). */
  readonly foreground: string;
  /** Background token it renders on. */
  readonly background: string;
  readonly kind: PairKind;
  /** Where in the SDK this pair is actually rendered. */
  readonly usage: string;
  /**
   * Modes the threshold is enforced in (measured and reported in all modes
   * regardless). Surface pairs enforce dark only: in light mode, ambient
   * light and shadows carry small fill deltas, while dark-mode display
   * flare compresses them — the failure mode reported in issue #187.
   */
  readonly enforcedModes?: readonly ("light" | "dark")[];
}

const pair = (
  foreground: string,
  background: string,
  kind: PairKind,
  usage: string,
  enforcedModes?: readonly ("light" | "dark")[],
): ContrastPair => ({
  foreground,
  background,
  kind,
  usage,
  ...(enforcedModes !== undefined && { enforcedModes }),
});

const STATUSES = [
  "ready",
  "running",
  "pending",
  "degraded",
  "failed",
  "disabled",
  "draft",
] as const;

const SYNTAX = [
  "keyword",
  "property",
  "string",
  "number",
  "bool",
  "atom",
  "meta",
  "tag",
] as const;

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // ── Core text on core surfaces ──────────────────────────────────────
  pair("--stgm-foreground", "--stgm-background", "text", "body text everywhere"),
  pair("--stgm-card-foreground", "--stgm-card", "text", "card bodies (ApprovalCard, TodoCard, plan cards)"),
  pair("--stgm-popover-foreground", "--stgm-popover", "text", "dropdowns, dialogs, menus"),
  pair("--stgm-primary-foreground", "--stgm-primary", "text", "primary buttons (composer send, approval Approve)"),
  pair("--stgm-secondary-foreground", "--stgm-secondary", "text", "secondary buttons"),
  pair("--stgm-accent-foreground", "--stgm-accent", "text", "hovered menu items, selected rows"),
  pair("--stgm-muted-foreground", "--stgm-muted", "text", "supporting text in muted panels (ExecutionErrorNotice interrupted state)"),
  pair("--stgm-muted-foreground", "--stgm-background", "text", "Thinking indicator, timestamps, captions (SetupProgress, ThinkingMessage)"),
  pair("--stgm-muted-foreground", "--stgm-card", "text", "supporting text inside cards"),
  pair("--stgm-foreground", "--stgm-muted-subtle", "text", "user message bubble text (MessageEntry HumanMessage), markdown table headers"),
  pair("--stgm-muted-foreground", "--stgm-muted-subtle", "text", "secondary affordances inside the user bubble"),

  // ── Semantic text ───────────────────────────────────────────────────
  pair("--stgm-destructive-foreground", "--stgm-destructive", "text", "destructive buttons (approval Deny)"),
  pair("--stgm-destructive", "--stgm-destructive-subtle", "text", "error notices (ExecutionErrorNotice failure state), terminal exit-code badge (TerminalSession)"),
  pair("--stgm-destructive", "--stgm-muted-subtle", "text", "stderr output on the shared code/output surface (TerminalSession)"),
  pair("--stgm-destructive", "--stgm-background", "text", "inline error text (FailedUserMessage)"),
  pair("--stgm-success-foreground", "--stgm-success", "text", "success badges"),
  pair("--stgm-warning-foreground", "--stgm-warning", "text", "warning badges"),
  pair("--stgm-info-foreground", "--stgm-info", "text", "info badges"),

  // ── Sidebar context ─────────────────────────────────────────────────
  pair("--stgm-sidebar-foreground", "--stgm-sidebar", "text", "sidebar navigation labels"),
  pair("--stgm-sidebar-muted-foreground", "--stgm-sidebar", "text", "sidebar section headers, secondary labels"),
  pair("--stgm-sidebar-primary-foreground", "--stgm-sidebar-primary", "text", "sidebar primary actions"),
  pair("--stgm-sidebar-accent-foreground", "--stgm-sidebar-accent", "text", "sidebar active/hovered items"),

  // ── Status badges (StatusBadge: status text on its subtle fill) ─────
  ...STATUSES.map((status) =>
    pair(
      `--stgm-status-${status}`,
      `--stgm-status-${status}-subtle`,
      "text",
      `StatusBadge "${status}" pill`,
    ),
  ),
  ...STATUSES.map((status) =>
    pair(
      `--stgm-status-${status}-foreground`,
      `--stgm-status-${status}`,
      "text",
      `solid "${status}" status fill with foreground text`,
    ),
  ),

  // ── Diff viewer ─────────────────────────────────────────────────────
  pair("--stgm-diff-added-fg", "--stgm-diff-added-bg", "text", "diff added lines"),
  pair("--stgm-diff-removed-fg", "--stgm-diff-removed-bg", "text", "diff removed lines"),
  pair("--stgm-diff-hunk-header-fg", "--stgm-diff-hunk-header-bg", "text", "diff hunk headers"),

  // ── Syntax highlighting (code blocks render on bg-muted) ────────────
  ...SYNTAX.map((token) =>
    pair(
      `--stgm-syntax-${token}`,
      "--stgm-muted",
      "text",
      `highlighted code "${token}" tokens (markdown-components pre)`,
    ),
  ),
  // Comments are deliberately de-emphasized but must stay readable.
  pair("--stgm-syntax-comment", "--stgm-muted", "supporting", "highlighted code comments"),

  // ── Deliberately de-emphasized text (readability floor, not AA) ─────
  pair("--stgm-muted-foreground-subtle", "--stgm-background", "supporting", "tertiary captions"),
  pair("--stgm-muted-foreground-faint", "--stgm-background", "supporting", "faintest hints (placeholder-level text)"),
];

/**
 * Adjacent-surface pairs: fills that must visibly separate from the surface
 * behind them *without* a border — only genuinely borderless fills belong
 * here. Cards, popovers, and buttons separate via border + shadow, so their
 * fill delta is intentionally not part of the contract.
 *
 * Enforced in dark mode only (see ContrastPair.enforcedModes): the light
 * values ship far below the threshold by design and read fine under ambient
 * light; the dark values are where fills melt into the page (issue #187).
 */
export const SURFACE_PAIRS: readonly ContrastPair[] = [
  pair("--stgm-muted-subtle", "--stgm-background", "surface", "user message bubble on thread background (borderless)", ["dark"]),
  pair("--stgm-muted", "--stgm-background", "surface", "code blocks, muted panels on the page (borderless)", ["dark"]),
];
