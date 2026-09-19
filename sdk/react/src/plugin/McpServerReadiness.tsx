"use client";

/**
 * One installed MCP server's readiness, rendered as a cell: a status dot
 * and a word, a Sign in button when a sign-in is what stands between the
 * server and its first tool call, one sentence when a key does.
 *
 * Two surfaces render it and must say the same thing: the plugin's page,
 * beside each MCP-server member, and the session composer, for an agent
 * whose server nobody has signed in to yet. The words are the picker's
 * (`inlineHealthProps`), the busy labels the server page's
 * (`oauthPhaseLabel`), so a user who has seen one surface reads the other
 * without learning new vocabulary. All state lives in
 * `useMcpServerReadiness`; this file only renders it.
 */

import { cn } from "@stigmer/theme";
import { Button } from "../button/Button.js";
import { inlineHealthProps } from "../mcp-server/McpServerConfigPanel.js";
import { oauthPhaseLabel } from "../mcp-server/McpServerDetailView.js";
import { type UseMcpServerReadinessReturn, useMcpServerReadiness } from "./useMcpServerReadiness.js";

/** Props for {@link McpServerReadiness}. */
export interface McpServerReadinessProps {
  /** The organization the server lives in. */
  readonly org: string;
  /** The server's slug. */
  readonly slug: string;
  /**
   * Where an `api-key` server's variables are given. `"agent"` when the
   * plugin installed an agent that declares them (the composer asks at the
   * agent's first session); `"connect"` otherwise (they are set when the
   * server is connected).
   */
  readonly keysAskedAt: "agent" | "connect";
  readonly className?: string;
}

/**
 * Renders {@link useMcpServerReadiness} for one server.
 *
 * @example
 * ```tsx
 * <McpServerReadiness org="acme" slug="linear" keysAskedAt="connect" />
 * ```
 */
export function McpServerReadiness({ org, slug, keysAskedAt, className }: McpServerReadinessProps) {
  const readiness = useMcpServerReadiness(org, slug);
  return <McpServerReadinessView readiness={readiness} keysAskedAt={keysAskedAt} className={className} />;
}

/** The cell over an already-resolved readiness; the composer renders this one so its hook can live where the agent is resolved. */
export function McpServerReadinessView({
  readiness,
  keysAskedAt,
  className,
}: {
  readonly readiness: UseMcpServerReadinessReturn;
  readonly keysAskedAt: "agent" | "connect";
  readonly className?: string;
}) {
  const root = cn("stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:justify-end stg:gap-2 stg:text-xs", className);
  switch (readiness.kind) {
    case "loading":
      return (
        <span className={cn(root, "stg:text-muted-foreground")} role="status">
          Reading…
        </span>
      );
    case "unreadable":
      return (
        <span className={cn(root, "stg:text-destructive")} role="status">
          {readiness.error?.message ?? "This server could not be read."}
        </span>
      );
    case "signed-in":
    case "approval-pending": {
      const health = inlineHealthProps(readiness.connectionHealth, readiness.kind === "signed-in", readiness.kind === "approval-pending");
      return (
        <span className={cn(root, health.textClass)} role="status">
          <Dot className={health.dotClass} />
          {health.label}
        </span>
      );
    }
    case "sign-in-needed": {
      const health = inlineHealthProps(readiness.connectionHealth, false, false);
      return (
        <span className={root}>
          {readiness.error && (
            <span role="alert" className="stg:text-destructive">
              {readiness.error.message}
            </span>
          )}
          {!readiness.isSigningIn && (
            <span className={cn("stg:inline-flex stg:items-center stg:gap-1.5", health.textClass)}>
              <Dot className={health.dotClass} />
              {health.label}
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={readiness.signIn}
            disabled={readiness.isSigningIn}
            aria-label={`Sign in to ${readiness.mcpServer?.metadata?.name || readiness.mcpServer?.metadata?.slug || "this server"}`}
          >
            {readiness.isSigningIn ? oauthPhaseLabel(readiness.phase) : "Sign in"}
          </Button>
        </span>
      );
    }
    case "api-key":
      return (
        <span className={cn(root, "stg:text-muted-foreground")}>
          Needs <code className="stg:font-mono stg:text-foreground">{readiness.declaredVariables.join(", ")}</code>
          {keysAskedAt === "agent" ? "; the agent asks at its first session." : "; set when you connect it."}
        </span>
      );
    case "open":
      return null;
    default: {
      const exhaustive: never = readiness.kind;
      return exhaustive;
    }
  }
}

function Dot({ className }: { readonly className: string }) {
  return <span aria-hidden="true" className={cn("stg:inline-block stg:size-2 stg:rounded-full", className)} />;
}
