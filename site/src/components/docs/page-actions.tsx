"use client";

import { useCallback, useState } from "react";
import { Check, Copy, MessageSquarePlus } from "lucide-react";
import { SITE_CONFIG } from "@/lib/constants";

interface PageActionsProps {
  /** URL of the plain markdown (.md) variant of the current page. */
  markdownUrl: string;
  pageTitle: string;
  pageUrl: string;
}

function buildIssueUrl(pageTitle: string, pageUrl: string): string {
  const fullUrl = `${SITE_CONFIG.url}${pageUrl}`;

  const title = `Docs feedback: ${pageTitle}`;

  const body = `**Page**: [${pageTitle}](${fullUrl})

---

<!-- Describe the issue below. What's wrong, missing, or confusing? -->

`;

  const params = new URLSearchParams({
    labels: "documentation",
    title,
    body,
  });

  return `${SITE_CONFIG.githubUrl}/issues/new?${params.toString()}`;
}

/**
 * Per-page actions for the docs right rail (rendered in the TOC footer on
 * desktop and the TOC popover footer on smaller viewports — one component,
 * both slots):
 *
 * - "Copy page" fetches the page's markdown export and copies it to the
 *   clipboard, for sharing with LLMs and other markdown consumers.
 * - "Share feedback" opens a pre-filled GitHub issue for the current page.
 */
export function PageActions({
  markdownUrl,
  pageTitle,
  pageUrl,
}: PageActionsProps) {
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

  const copyLabel =
    state === "copied"
      ? "Copied!"
      : state === "error"
        ? "Failed to copy"
        : "Copy page";

  const actionClass =
    "inline-flex items-center gap-2 py-1 text-sm text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

  return (
    <div className="mt-3 flex flex-col items-start gap-1 border-t border-fd-border pt-3">
      <button
        type="button"
        onClick={handleCopy}
        disabled={state === "copying"}
        aria-label={copyLabel}
        className={actionClass}
      >
        {state === "copied" ? <Check className="text-fd-primary" /> : <Copy />}
        {copyLabel}
      </button>
      <a
        href={buildIssueUrl(pageTitle, pageUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className={actionClass}
      >
        <MessageSquarePlus />
        Share feedback
      </a>
    </div>
  );
}
