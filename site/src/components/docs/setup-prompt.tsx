"use client";

/**
 * `<SetupPrompt />`: the docs front page's one thing to do.
 *
 * The prompt that sets Stigmer up in the reader's app through their coding
 * agent, in a block, with a button that copies it and one line saying where
 * to paste it (src/components/visuals/setup-prompt.ts holds the words). The
 * block wraps the prompt to the column, so a phone shows it whole with no
 * sideways scroll, and Copy gives the clipboard the one paragraph a coding
 * agent reads either way. Nothing moves.
 *
 * Copy is the hook the docs' code blocks use, on the site's own button at its
 * 44px size. The markdown exports carry the block as text (`SetupPrompt` in
 * src/lib/llms-pages.ts).
 */
import { Check, Copy } from "lucide-react";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COPIED, COPY, PROMPT, THEN } from "@/components/visuals/setup-prompt";

export function SetupPrompt({ className }: { className?: string }) {
  const [copied, copy] = useCopyButton(() => navigator.clipboard.writeText(PROMPT));

  return (
    <figure data-setup-prompt="" className={cn("not-prose m-0 max-w-2xl", className)}>
      <pre className="m-0 rounded-xl border border-fd-border bg-fd-card px-4 py-3.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fd-foreground">
        {PROMPT}
      </pre>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 text-sm text-fd-muted-foreground">
        <Button type="button" size="lg" className="px-5 text-sm" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? COPIED : COPY}
        </Button>
        <span className="min-w-0 flex-1 basis-64">{THEN}</span>
      </figcaption>
    </figure>
  );
}
