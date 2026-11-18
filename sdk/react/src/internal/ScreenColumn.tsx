// The column the kit's own link pages draw in (an invitation, a Connect
// link and its return, the OAuth pop-up): a title and its line, centred,
// then the page's body and its acts, each act the column's width. It is the
// standalone frame's column without the frame, so a builder can put these
// pages under their own header, and the console puts them in its
// `StandaloneScreen` with its mark and help line. Internal: the kit's views
// use it.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** Props for {@link ScreenColumn}. */
export interface ScreenColumnProps {
  /** The page's heading. */
  readonly title?: ReactNode;
  /** Its level: 1 when the column is the page, 2 under a page's own heading. */
  readonly headingLevel?: 1 | 2;
  /** One line under the title. */
  readonly lead?: ReactNode;
  /** Small facts under the line (an invitation's role and expiry). */
  readonly meta?: ReactNode;
  /** The body: a wait, a failure note. */
  readonly children?: ReactNode;
  /** The acts, each the column's width. */
  readonly acts?: ReactNode;
  readonly className?: string;
}

/** A link page's column: title, line, body and acts. */
export function ScreenColumn({ title, headingLevel = 2, lead, meta, children, acts, className }: ScreenColumnProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const top = title !== undefined || lead !== undefined || meta !== undefined;
  return (
    <div className={cn("stg:mx-auto stg:flex stg:w-full stg:max-w-sm stg:flex-col stg:gap-6", className)}>
      {top && (
        <div className="stg:flex stg:flex-col stg:items-center stg:gap-4 stg:text-center">
          {title !== undefined && <Heading className="stg:m-0 stg:text-xl stg:font-semibold stg:text-foreground">{title}</Heading>}
          {lead !== undefined && <p className="stg:m-0 stg:-mt-2 stg:text-sm stg:text-muted-foreground">{lead}</p>}
          {meta !== undefined && (
            <div className="stg:flex stg:flex-col stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground">{meta}</div>
          )}
        </div>
      )}
      {children}
      {acts !== undefined && <div className="stg:flex stg:flex-col stg:gap-2 stg:[&>*]:w-full">{acts}</div>}
    </div>
  );
}
