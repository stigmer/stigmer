"use client";

// Where a person stuck on this server asks for help, drawn where they look
// for it: a row at the foot of the console's sidebar, and a line under a
// sign-in button, an invite or a failure ("Stuck? Ask IT on Slack"). The
// address and its words are the server operator's (`getServerInfo`'s
// `help`, read through `useHelpLink`); nothing about any deployment's help
// is written here, and without one both forms draw nothing.

import { useContext } from "react";
import { LifeBuoy } from "lucide-react";
import { StigmerContext } from "@stigmer/react-core";
import { cn } from "@stigmer/design-tokens";
import type { HelpLink as HelpLinkValue } from "@stigmer/client";
import { useHelpLink } from "../server-info.js";
import { navRowClassName } from "../sidebar/chrome.js";
import { useShowHelpLink } from "./help-link-context.js";

/** Props for {@link HelpLink}. */
export interface HelpLinkProps {
  /**
   * `row`: an icon and the words, sized as a sidebar row, for the sidebar's
   * `footer`. `line`: "Stuck? <words>" in small muted text, under an act.
   * @default "line"
   */
  readonly variant?: "row" | "line";
  readonly className?: string;
}

/**
 * The connected server's help link, or nothing when its operator set none,
 * and nothing outside a `StigmerProvider` (a page that failed before its
 * client was made), so it is safe on any error screen.
 *
 * Place it on your own console's screens: the sidebar's `footer` (`row`),
 * under a sign-in button or a gate's "Try again" (`line`). A web address
 * opens in a new tab; a `mailto:` address opens in place. Never place it
 * inside an app you make for your own users: the link is where your
 * server's operator answers, not where your users get help.
 *
 * @example
 * ```tsx
 * import { HelpLink, UserMenu } from "@stigmer/react-sdk/console";
 *
 * function SidebarFooter({ onSignOut }: { onSignOut: () => void }) {
 *   return (
 *     <>
 *       <HelpLink variant="row" />
 *       <UserMenu user={{ name: "Dana" }} onSignOut={onSignOut} />
 *     </>
 *   );
 * }
 * ```
 */
export function HelpLink(props: HelpLinkProps) {
  return useContext(StigmerContext) === null ? null : <ServerHelpLink {...props} />;
}

/** {@link HelpLink} inside a provider: reads the server's answer. */
function ServerHelpLink({ variant = "line", className }: HelpLinkProps) {
  const help = useHelpLink();
  if (help === undefined) return null;
  return variant === "row" ? (
    <HelpRow help={help} className={className} />
  ) : (
    <HelpLine help={help} className={className} />
  );
}

/**
 * The line a failed notice ends with, when the host turned it on
 * (`StigmerProvider`'s `showHelpLink`). Split from the notice so a notice
 * outside a console reads no server at all. @internal
 */
export function FailureHelpLine() {
  return useShowHelpLink() ? <HelpLink variant="line" className="stg:mt-2" /> : null;
}

/** A web address opens beside the console; a mail address opens the mail app in place. */
function linkTarget(url: string): { target?: "_blank"; rel?: string } {
  return url.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" };
}

function HelpRow({ help, className }: { readonly help: HelpLinkValue; readonly className: string | undefined }) {
  return (
    <a href={help.url} {...linkTarget(help.url)} className={cn(navRowClassName(false), "stg:mb-1 stg:no-underline", className)}>
      <LifeBuoy className="stg:size-4 stg:shrink-0" aria-hidden="true" />
      <span className="stg:min-w-0 stg:truncate">{help.label}</span>
    </a>
  );
}

function HelpLine({ help, className }: { readonly help: HelpLinkValue; readonly className: string | undefined }) {
  return (
    <p className={cn("stg:m-0 stg:text-xs stg:text-muted-foreground", className)}>
      Stuck?{" "}
      <a
        href={help.url}
        {...linkTarget(help.url)}
        className="stg:text-foreground stg:underline stg:decoration-border stg:underline-offset-4 stg:hover:decoration-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm"
      >
        {help.label}
      </a>
    </p>
  );
}
