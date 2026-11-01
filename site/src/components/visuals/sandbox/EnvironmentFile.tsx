/**
 * The sandbox section's "inside" artifact: the docs' worked Environment
 * file, shown as an admin writes it, headed by its kind and slug. The text is
 * brand/sandbox.ts's, which brand/__tests__/sandbox.test.ts holds equal to
 * the docs page. Its longest line runs about 60 characters: on a wide
 * screen the card shows it whole; on a phone only this box scrolls
 * sideways, never the page.
 */
import { SANDBOX_ENVIRONMENT } from "../../../../../brand/sandbox";

export function EnvironmentFile() {
  return (
    <figure className="m-0 min-w-0 rounded-md border border-border bg-background overflow-hidden">
      <figcaption className="flex items-center justify-between gap-4 border-b border-border px-4 py-2 font-mono text-xs">
        <span className="uppercase tracking-wider text-subtle">
          Environment
        </span>
        <span className="text-foreground">{SANDBOX_ENVIRONMENT.slug}</span>
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={`The ${SANDBOX_ENVIRONMENT.slug} Environment`}
        className="m-0 overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground/85"
      >
        <code>{SANDBOX_ENVIRONMENT.file.trimEnd()}</code>
      </pre>
    </figure>
  );
}
