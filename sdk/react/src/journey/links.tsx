// Where the journey's later steps lead, as a host routes them, shared by the
// dashboard's card, the launcher's next line and the line under a first
// job. The kit has no router: each destination is the host's, and a step
// whose destination is not passed has no act.

import type { ReactNode } from "react";
import type { ResourceRef } from "@stigmer/client";

/** Draws a journey link; a host with its own router passes its link component. */
export type RenderJourneyLink = (props: { readonly href: string; readonly className: string; readonly children: ReactNode }) => ReactNode;

/** The journey's destinations past the first job, in the host's routing. */
export interface JourneyLinks {
  /**
   * The agent page's "Make it yours" tab for an agent (the console's
   * `/library/agents/<org>/<slug>?tab=make-it-yours`).
   */
  readonly makeItYours?: (agent: ResourceRef) => string;
  /** Where an agent is put in front of users: today its Channels tab. */
  readonly putInApp?: (agent: ResourceRef) => string;
  /** Where the team is invited (the console's members page). */
  readonly bringOthers?: string;
  /** Draws each link; a plain anchor otherwise. */
  readonly renderLink?: RenderJourneyLink;
}

/** A plain anchor, for a host that passes no link component. */
export const anchorLink: RenderJourneyLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);
