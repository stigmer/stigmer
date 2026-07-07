"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link OAuthRequiredNotice}. */
export interface OAuthRequiredNoticeProps {
  /**
   * The server's `spec.auth.oauth_only` flag. When `true`, the endpoint
   * rejects manually-entered static tokens and OAuth is the only path.
   */
  readonly oauthOnly: boolean | undefined;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Sets accurate expectations for connecting an **OAuth-only** MCP server —
 * one whose hosted endpoint rejects manually-entered static tokens
 * (`spec.auth.oauth_only`, e.g. Notion, Monday).
 *
 * Without this notice a user might expect the (now-hidden) manual token
 * option and wonder why only "Sign in" is offered. It explains, in one line,
 * that OAuth is required and a pasted API token would be rejected — turning a
 * silent constraint into a clear one (Nielsen: visibility of system status).
 *
 * Self-gating: renders `null` unless the server is `oauth_only`. Callers
 * render it unconditionally next to their Connect action, mirroring
 * {@link StdioSandboxNotice}.
 *
 * All visual properties flow through `--stgm-*` design tokens. No
 * Console-specific dependencies — safe for platform-builder embedding.
 */
export function OAuthRequiredNotice({
  oauthOnly,
  className,
}: OAuthRequiredNoticeProps) {
  if (!oauthOnly) return null;

  return (
    <div
      role="status"
      className={cn(
        "bg-muted-subtle text-muted-foreground flex items-start gap-2.5 rounded-lg border border-transparent px-4 py-3",
        className,
      )}
    >
      <KeyIcon className="mt-0.5 size-4 shrink-0" />
      <p className="text-xs leading-relaxed">
        This server requires OAuth. Sign in to connect — its hosted endpoint
        rejects manually-entered API tokens, so a pasted token won&apos;t work
        here.
      </p>
    </div>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="5" cy="11" r="2.5" />
      <path d="M6.8 9.2 13 3" />
      <path d="M11 5l1.5 1.5" />
      <path d="M9 7l1.5 1.5" />
    </svg>
  );
}
