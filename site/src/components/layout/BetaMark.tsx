/**
 * The "Beta" mark beside Stigmer's brand in the site's header and the docs'
 * header, linking the page that says what Beta means and the bar for lifting
 * it. The word, the line and the page are the brand's (brand/beta.ts, whose
 * test holds every copy); the mark carries the whole line as its accessible
 * name and tooltip, since the header has room for the word alone.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { badgeVariants } from "@/components/ui/badge";
import { BETA } from "../../../../brand/beta";

export function BetaMark({ className }: { className?: string }) {
  return (
    <Link
      href={BETA.path}
      aria-label={BETA.line}
      title={BETA.line}
      className={cn(
        badgeVariants({ variant: "outline" }),
        "shrink-0 px-2 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {BETA.word}
    </Link>
  );
}
