"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
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
 * - `box`: the muted, bordered box code sits in on its own; without it the
 *   block draws no frame, for one inside a frame its host draws (a file
 *   preview, a copy row, an error's box).
 * - `wrap`: long lines wrap instead of scrolling sideways (a command, an
 *   error), and keep their indentation either way.
 * - `label`: makes the block a scroll region the keyboard reaches, named by
 *   the label (a manifest, a snippet).
 *
 * Layout (a flex share, a padding inside a bare host, a height cap with its
 * own scroll) comes through `className`; the face, size, line and colour are
 * the part's.
 *
 * @internal Not part of the public API.
 */
export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLPreElement>, "children"> {
  readonly children: ReactNode;
  readonly size?: "2xs" | "xs" | "sm";
  readonly box?: boolean;
  readonly wrap?: boolean;
  readonly label?: string;
  readonly ref?: Ref<HTMLPreElement>;
}

// Each size is the scale's own step, which carries its paired line (11 and
// 12px on 16px, 14px on 20px): no line-height class of its own.
const SIZE: Record<NonNullable<CodeBlockProps["size"]>, string> = {
  "2xs": "stg:text-2xs",
  xs: "stg:text-xs",
  sm: "stg:text-sm",
};

const BOX = "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-2.5 stg:py-2";

export function CodeBlock({ children, size = "xs", box, wrap, label, className, ref, ...rest }: CodeBlockProps) {
  return (
    <pre
      ref={ref}
      {...(label && scrollRegion(label))}
      {...rest}
      className={cn(
        "stg:m-0 stg:font-mono stg:text-foreground",
        SIZE[size],
        box && BOX,
        wrap ? "stg:whitespace-pre-wrap stg:break-words" : "stg:overflow-x-auto",
        label && SCROLL_REGION_FOCUS,
        className,
      )}
    >
      {children}
    </pre>
  );
}
