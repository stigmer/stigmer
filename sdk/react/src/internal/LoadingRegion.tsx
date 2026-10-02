import type { ReactNode } from "react";

/**
 * The SDK's container for a labelled loading region: the region a skeleton
 * fills while its data is in flight, marked busy and named for a screen reader
 * without a role. A skeleton with no name needs none of this and stays a bare
 * busy element.
 *
 * Why hidden text, not `aria-label`: a `div` with no role may not take
 * `aria-label` (axe `aria-prohibited-attr`, WCAG 4.1.2), so a labelled
 * skeleton fails any page audit it is on screen for (stigmer/stigmer#1653).
 * Why no role: `status` is what this console's phase badges, empty states and
 * notices carry, and `progressbar` its usage gauge, so a skeleton with either
 * would answer locators meant for them.
 *
 * Why not a live region: a loading placeholder is not news. The content that
 * replaces it is what a screen reader user reads, and an announcement per
 * skeleton would talk over every panel that loads at once.
 *
 * `label` names a wordless skeleton ("Loading sessions"). Leave it out, or
 * empty, when the children already say what is loading in visible text, so a
 * screen reader does not read it twice. The hidden text comes first: the
 * containers space their children with `space-y-*` and `gap-*`, and an
 * absolutely positioned first child changes neither, where a trailing one
 * would give the last placeholder a margin it never had. The
 * `stigmer/require-loading-region` lint rule sends a busy element here when
 * axe would refuse its name, or when it takes role="status".
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
      {label ? <span className="stg:sr-only">{label}</span> : null}
      {children}
    </div>
  );
}
