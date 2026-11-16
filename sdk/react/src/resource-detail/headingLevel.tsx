"use client";

/**
 * The heading levels a detail page's parts take from its title: a section's
 * title is one level under the page's title, and a heading inside a section
 * one level under that. `ResourceDetailShell` provides the section level from
 * its own `headingLevel`, so a view the console shows as the page (title
 * `h1`, sections `h2`) and a view a host embeds under its own heading (title
 * `h2`, sections `h3`) both keep their outline in order.
 */

import { createContext, useContext, type ReactNode } from "react";

/** The level of a detail page's section titles: 3 under an `h2` title (the default), 2 under an `h1`. */
export const SectionHeadingLevelContext = createContext<2 | 3>(3);

/** The level a section's title takes on this page. */
export function useSectionHeadingLevel(): 2 | 3 {
  return useContext(SectionHeadingLevelContext);
}

/** A heading inside a section: one level under the section's title. */
export function SubHeading({ className, children }: { readonly className?: string; readonly children: ReactNode }) {
  const level = useSectionHeadingLevel();
  return level === 2 ? <h3 className={className}>{children}</h3> : <h4 className={className}>{children}</h4>;
}
