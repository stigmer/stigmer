import type { ReactNode } from "react";

/**
 * The SDK's one loading container: the region a skeleton fills while its data
 * is in flight, marked busy and named for a screen reader without a role.
 *
 * Every skeleton used to carry `aria-busy="true"` and an `aria-label` on a
 * plain `div`. A `div` with no role may not take `aria-label` (axe
 * `aria-prohibited-attr`, WCAG 4.1.2), so a page audit failed whenever one was
 * on screen, as the console's audits did on a slow machine (stigmer/stigmer#1653).
 * A role would not do either: `status` is what this console's phase badges,
 * empty states and notices carry, and `progressbar` its usage gauge, so a
 * skeleton with either would answer locators meant for them. The name is
 * visually hidden text instead, read in place.
 *
 * Deliberately not a live region: the two skeletons that had role="status"
 * (the file viewer's and the explorer's) were announced as they appeared, and
 * no longer are. A loading placeholder is not news; the content that replaces
 * it is what a screen reader user reads, and an announcement per skeleton
 * would talk over every panel that loads at once.
 *
 * `label` names a wordless skeleton ("Loading sessions"). Leave it out when the
 * children already say what is loading in visible text, so a screen reader
 * does not read it twice. The hidden text comes first: the containers space
 * their children with `space-y-*` and `gap-*`, and an absolutely positioned
 * first child changes neither, where a trailing one would give the last
 * placeholder a margin it never had. The `stigmer/require-loading-region`
 * lint rule keeps every busy container on this component.
 *
 * @internal Not part of the public API.
 */
export function LoadingRegion({
  label,
  className,
  children,
}: {
  readonly label?: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className={className} aria-busy="true">
      {label !== undefined && <span className="stg:sr-only">{label}</span>}
      {children}
    </div>
  );
}
