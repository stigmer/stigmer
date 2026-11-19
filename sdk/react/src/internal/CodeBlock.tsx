"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { SCROLL_REGION_FOCUS, scrollRegion } from "./scroll-region.js";

/**
 * The kit's one code block: every block of code or command text the console
 * draws (an agent's YAML, a file's source in a session, a routine's curl, an
 * embed snippet, a Slack manifest, a provider's install commands) is this
 * `<pre>`, in mono on the type scale. Each size keeps the line height its
 * step pairs (`sdk/theme/src/tokens.css`): 11 and 12px on 16px lines, 14px
 * on 20px. Before 2026-11 the kit drew code six different ways, five on a
 * loose 1.625 line off the scale; the lint rule `no-handrolled-code-block`
 * keeps a hand-drawn mono `<pre>` from coming back.
 *
 * - `size`: `xs` (12/16) is code's size wherever it is read; `2xs` (11/16)
 *   is the compact copy form beside settings; `sm` (14/20) is a value a
 *   person typed and reads as text (an agent's instructions).
 * - `frame`: `box` is the muted, bordered box code sits in on its own;
 *   `bare` draws no frame, for a block inside a frame its host draws (a file
 *   preview, a copy row); `alert` is an error's words in the destructive
 *   box.
 * - `wrap`: long lines wrap instead of scrolling sideways (a command, an
 *   error), and keep their indentation either way.
 * - `label`: makes the block a scroll region the keyboard reaches, named by
 *   the label (a manifest, a snippet); `maxHeight` caps its height.
 *
 * Layout (a flex share, a padding inside a bare host) comes through
 * `className`; the face, size, line and colour are the part's.
 *
 * @internal Not part of the public API.
 */
export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLPreElement>, "children"> {
  readonly children: ReactNode;
  readonly size?: "2xs" | "xs" | "sm";
  readonly frame?: "box" | "bare" | "alert";
  readonly wrap?: boolean;
  readonly label?: string;
  readonly maxHeight?: "40" | "80" | "96";
}

const SIZE: Record<NonNullable<CodeBlockProps["size"]>, string> = {
  "2xs": "stg:text-2xs stg:leading-4",
  xs: "stg:text-xs stg:leading-4",
  sm: "stg:text-sm stg:leading-5",
};

const FRAME: Record<NonNullable<CodeBlockProps["frame"]>, string> = {
  box: "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-2.5 stg:py-2 stg:text-foreground",
  bare: "stg:text-foreground",
  alert: "stg:rounded-md stg:border stg:border-destructive/20 stg:bg-destructive-subtle stg:p-2 stg:text-destructive",
};

const MAX_HEIGHT: Record<NonNullable<CodeBlockProps["maxHeight"]>, string> = {
  "40": "stg:max-h-40 stg:overflow-y-auto",
  "80": "stg:max-h-80 stg:overflow-y-auto",
  "96": "stg:max-h-96 stg:overflow-y-auto",
};

export const CodeBlock = forwardRef<HTMLPreElement, CodeBlockProps>(function CodeBlock(
  { children, size = "xs", frame = "box", wrap = false, label, maxHeight, className, ...rest },
  ref,
) {
  return (
    <pre
      ref={ref}
      {...(label !== undefined ? scrollRegion(label) : {})}
      {...rest}
      className={cn(
        "stg:m-0 stg:font-mono",
        SIZE[size],
        FRAME[frame],
        wrap ? "stg:whitespace-pre-wrap stg:break-words" : "stg:overflow-x-auto",
        maxHeight !== undefined && MAX_HEIGHT[maxHeight],
        label !== undefined && SCROLL_REGION_FOCUS,
        className,
      )}
    >
      {children}
    </pre>
  );
});
