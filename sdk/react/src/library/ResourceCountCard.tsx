"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link ResourceCountCard}. */
export interface ResourceCountCardProps {
  /**
   * Icon element rendered at the top of the card. Sized by the consumer.
   *
   * Should be marked `aria-hidden="true"` when purely decorative
   * (typical for resource type icons alongside a text label).
   */
  readonly icon: React.ReactNode;
  /** Display label — e.g. "Agents", "Skills", "MCP Servers". */
  readonly label: string;
  /**
   * Resource count to display. When `undefined` and `isLoading` is
   * true, a skeleton placeholder renders in its place. When `undefined`
   * and `isLoading` is false, an em-dash is shown as a neutral
   * placeholder.
   *
   * When a count is already available and `isLoading` becomes true
   * again (refresh scenario), the existing count remains visible —
   * no skeleton flash.
   */
  readonly count?: number;
  /**
   * Whether the count is being fetched. Shows a skeleton pulse when
   * `count` is not yet available.
   */
  readonly isLoading?: boolean;
  /**
   * URL for the card. When provided, the card renders as an `<a>`
   * element for accessible navigation (right-click, open in new tab,
   * browser status bar URL preview).
   *
   * For SPA routing, combine with `onClick` and call `preventDefault`:
   *
   * ```tsx
   * <ResourceCountCard
   *   href="/library/agents"
   *   onClick={(e) => { e.preventDefault(); router.push("/library/agents"); }}
   *   // ...
   * />
   * ```
   */
  readonly href?: string;
  /**
   * Click handler. When `href` is also provided, the card renders as
   * `<a>` — call `e.preventDefault()` for SPA navigation. When only
   * `onClick` is provided without `href`, the card renders as
   * `<button>`.
   */
  readonly onClick?: (e: React.MouseEvent) => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Card displaying a resource type icon, count, and label — designed
 * for Library landing pages and resource dashboards.
 *
 * Purely presentational: the consumer provides the count (typically
 * from {@link useAgentCount}, {@link useSkillCount}, or
 * {@link useMcpServerCount}) and the card handles rendering, loading
 * skeletons, and accessible navigation semantics.
 *
 * The root element adapts to the provided props:
 *
 * - `href` → `<a>` (link: right-click, open in new tab, Enter to follow)
 * - `onClick` only → `<button>` (action: Enter/Space to activate)
 * - Neither → `<div>` (static display)
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Static display
 * const { count, isLoading } = useAgentCount("acme");
 *
 * <ResourceCountCard
 *   icon={<BotIcon className="h-5 w-5" aria-hidden="true" />}
 *   label="Agents"
 *   count={count}
 *   isLoading={isLoading}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Navigable card with SPA routing
 * <ResourceCountCard
 *   icon={<BotIcon className="h-5 w-5" aria-hidden="true" />}
 *   label="Agents"
 *   count={agentCount}
 *   isLoading={isAgentLoading}
 *   href="/library/agents"
 *   onClick={(e) => {
 *     e.preventDefault();
 *     router.push("/library/agents");
 *   }}
 * />
 * ```
 *
 * @see {@link useAgentCount} — data hook for agent count
 * @see {@link useSkillCount} — data hook for skill count
 * @see {@link useMcpServerCount} — data hook for MCP server count
 */
export function ResourceCountCard({
  icon,
  label,
  count,
  isLoading = false,
  href,
  onClick,
  className,
}: ResourceCountCardProps) {
  const isInteractive = !!href || !!onClick;
  const showSkeleton = isLoading && count === undefined;

  const rootClasses = cn(
    "stg:flex stg:flex-col stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4 stg:text-left stg:no-underline",
    isInteractive && [
      "stg:cursor-pointer stg:transition-colors stg:hover:bg-accent-hover",
      "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
    ],
    className,
  );

  const content = (
    <>
      <div className="stg:text-muted-foreground">{icon}</div>
      {showSkeleton ? (
        <div
          className="stg:mt-3 stg:h-7 stg:w-12 stg:animate-pulse stg:rounded stg:bg-muted"
          aria-hidden="true"
        />
      ) : (
        <div className="stg:mt-3 stg:text-2xl stg:font-semibold stg:tabular-nums stg:text-foreground">
          {count !== undefined ? count.toLocaleString() : "\u2014"}
        </div>
      )}
      <div className="stg:mt-1 stg:text-sm stg:text-muted-foreground">{label}</div>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        aria-label={buildAriaLabel(label, count, isLoading)}
        className={rootClasses}
      >
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={buildAriaLabel(label, count, isLoading)}
        className={rootClasses}
      >
        {content}
      </button>
    );
  }

  return <div className={rootClasses}>{content}</div>;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function buildAriaLabel(
  label: string,
  count: number | undefined,
  isLoading: boolean,
): string {
  if (count !== undefined) return `${label}: ${count.toLocaleString()}`;
  if (isLoading) return `${label}: loading`;
  return label;
}
