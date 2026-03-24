"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyMarkdownButtonProps {
  /** URL of the plain markdown (.md) variant of the current page. */
  markdownUrl: string;
}

/**
 * Fetches the plain-markdown version of a docs page and copies it to the
 * clipboard. Provides visual feedback (checkmark) on success.
 *
 * Intended for the docs page header so users can quickly share page
 * content with LLMs or other tools that consume markdown.
 */
export function CopyMarkdownButton({ markdownUrl }: CopyMarkdownButtonProps) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );

  const handleCopy = useCallback(async () => {
    setState("copying");
    try {
      const res = await fetch(markdownUrl);
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }, [markdownUrl]);

  const label =
    state === "copied"
      ? "Copied!"
      : state === "error"
        ? "Failed to copy"
        : "Copy page as Markdown";

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={state === "copying"}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring disabled:pointer-events-none"
    >
      {state === "copied" ? (
        <Check className="size-4 text-fd-primary" />
      ) : (
        <Copy className="size-4" />
      )}
    </button>
  );
}
