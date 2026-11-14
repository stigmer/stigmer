"use client";

// The console's one notice: a tinted note with an icon, a bold sentence on
// what happened, the lines under it, and its acts. A turn that didn't
// finish (`RunErrorNotice`), a page that couldn't load (`ErrorMessage`) and
// the kit's info notes draw here, so every failure reads the same way:
// what happened, what wasn't lost, one thing to do, and the details for
// whoever fixes it. A failed notice ends with the server's help link when
// the console turned it on (`StigmerProvider`'s `showHelpLink`), so a
// person stuck at the failure knows where to ask. Internal: the kit's own
// components use it.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../../button/Button.js";
import { useCopy } from "../CopyBlock.js";
import { FailureHelpLine } from "../../help/HelpLink.js";

/** A notice's tone: the status pill's hue for failed and paused, grey for plain. */
export type NoticeTone = "failed" | "paused" | "plain";

/** The one link a notice offers to the fix: its words, and where it goes or what it does. */
export interface NoticeLinkSpec {
  readonly label: string;
  /** An address to open; absent when the link is an action (`onClick`). */
  readonly href?: string;
  /** Opens outside the host: a new tab. */
  readonly external?: boolean;
  readonly onClick?: () => void;
}

/** The one act a notice offers. */
export interface NoticeAct {
  readonly label: ReactNode;
  readonly onClick: () => void;
  /** The act is in flight: its button waits. */
  readonly busy?: boolean;
  /** Leading icon. */
  readonly icon?: ReactNode;
}

/** Props for {@link Notice}. */
export interface NoticeProps {
  readonly tone: NoticeTone;
  /** The bold sentence: what happened. */
  readonly headline: ReactNode;
  /** The lines under it (each its own `<p>`), drawn in the foreground. */
  readonly children?: ReactNode;
  /** Replaces the tone's icon. */
  readonly icon?: ReactNode;
  /** The one act. */
  readonly act?: NoticeAct;
  /** The one link to the fix. */
  readonly link?: NoticeLinkSpec;
  /** What Copy details copies (the raw error, ids); no Copy details when absent or empty. */
  readonly details?: string;
  /** `alert` for a failure, `status` otherwise; the tone's by default. */
  readonly role?: "alert" | "status" | "note";
  readonly className?: string;
}

const TONE_CLASSES: Readonly<Record<NoticeTone, { readonly box: string; readonly icon: string }>> = {
  failed: { box: "stg:bg-status-failed-subtle", icon: "stg:text-status-failed" },
  paused: { box: "stg:bg-status-degraded-subtle", icon: "stg:text-status-degraded" },
  plain: { box: "stg:bg-muted", icon: "stg:text-muted-foreground" },
};

/**
 * A note on the page: an icon in the tone's hue, a bold headline, the
 * lines under it, and at most one act, one link and Copy details; a
 * failed one ends with the help line when the console turned it on.
 */
export function Notice({ tone, headline, children, icon, act, link, details = "", role, className }: NoticeProps) {
  const classes = TONE_CLASSES[tone];
  const copyable = details !== "";
  return (
    <div
      role={role ?? (tone === "failed" ? "alert" : "status")}
      className={cn("stg:flex stg:items-start stg:gap-3 stg:rounded-xl stg:p-4", classes.box, className)}
    >
      <span className={cn("stg:mt-0.5 stg:shrink-0", classes.icon)} aria-hidden="true">
        {icon ?? TONE_ICONS[tone]}
      </span>
      <div className="stg:flex stg:min-w-0 stg:flex-col stg:gap-1 stg:text-sm stg:text-foreground">
        <p className="stg:m-0 stg:font-semibold">{headline}</p>
        {children}
        {act !== undefined || link !== undefined || copyable ? (
          <div className="stg:mt-2 stg:flex stg:flex-wrap stg:items-center stg:gap-3">
            {act !== undefined && (
              <Button size="sm" icon={act.icon} onClick={act.onClick} disabled={act.busy === true} aria-busy={act.busy === true}>
                {act.label}
              </Button>
            )}
            {link !== undefined && <NoticeLink link={link} />}
            {copyable && <CopyDetails details={details} flush={act === undefined && link === undefined} />}
          </div>
        ) : null}
        {tone === "failed" && <FailureHelpLine />}
      </div>
    </div>
  );
}

function CopyDetails({ details, flush }: { readonly details: string; readonly flush: boolean }) {
  const { copied, copy } = useCopy(details);
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={copy}
      // Alone in its row it sits flush with the words above it.
      className={cn("stg:text-muted-foreground", flush && "stg:-ml-2.5")}
    >
      {copied ? "Copied" : "Copy details"}
    </Button>
  );
}

function NoticeLink({ link }: { readonly link: NoticeLinkSpec }) {
  const className =
    "stg:text-sm stg:text-foreground stg:underline stg:decoration-border stg:underline-offset-4 stg:hover:decoration-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm";
  if (link.href === undefined) {
    return (
      <button type="button" onClick={link.onClick} className={className}>
        {link.label}
      </button>
    );
  }
  return (
    <a
      href={link.href}
      onClick={link.onClick}
      className={className}
      {...(link.external === true ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {link.label}
    </a>
  );
}

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The paused tone's clock, for a caller whose plain or failed notice is about time. */
export const CLOCK_ICON: ReactNode = (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const TONE_ICONS: Readonly<Record<NoticeTone, ReactNode>> = {
  failed: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  ),
  paused: CLOCK_ICON,
  plain: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
};
