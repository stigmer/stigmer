import type { ReactNode } from "react";
import { glossary } from "./glossary";

interface TermProps {
  children: ReactNode;
}

/**
 * Inline glossary tooltip for Stigmer domain terms.
 *
 * Renders a dotted-underline span that shows the term's definition on
 * hover (mouse) and focus (keyboard). Uses pure CSS positioning — no
 * client-side JavaScript required.
 *
 * If the term has no glossary entry, falls back to plain text with no
 * visual indicator.
 *
 * @example
 * ```mdx
 * When you create a <Term>Workflow</Term>, you define each step.
 * ```
 */
export function Term({ children }: TermProps) {
  const text = typeof children === "string" ? children : String(children);
  const definition = glossary[text];

  if (!definition) {
    return <>{children}</>;
  }

  return (
    <span
      className="group/term relative inline cursor-help border-b border-dotted border-fd-muted-foreground/50"
      tabIndex={0}
      aria-label={`${text}: ${definition}`}
    >
      {children}
      <span
        role="tooltip"
        className={[
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2",
          "w-max max-w-xs whitespace-normal rounded-md px-3 py-2 text-sm",
          "bg-fd-popover text-fd-popover-foreground shadow-md border border-fd-border",
          "opacity-0 transition-opacity duration-150",
          "group-hover/term:opacity-100 group-focus/term:opacity-100",
        ].join(" ")}
      >
        {definition}
      </span>
    </span>
  );
}
