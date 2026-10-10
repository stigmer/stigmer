"use client";

/**
 * One plugin server's sign-in, rendered as a cell: a status dot and a
 * word, a Sign in button when a sign-in is what stands between the server
 * and its first tool call, Sign out beside a login saved at its address,
 * one sentence when a key does.
 *
 * Two surfaces render it and must say the same thing: the plugin's page,
 * beside each MCP server, and the session composer, for a server of the
 * agent's plugins nobody has signed in to yet. All state lives in
 * `usePluginServerSignIn`; this file only renders it. Signing out asks
 * once inline, as removing any vault entry does, because the login cannot
 * be read back.
 */

import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { Button } from "../button/Button.js";
import type { VaultSignInPhase } from "../vault/useVaultSignIn.js";
import { type UsePluginServerSignInReturn, usePluginServerSignIn } from "./usePluginServerSignIn.js";

/** Props for {@link PluginServerSignIn}. */
export interface PluginServerSignInProps {
  /** The organization whose My vault holds the login. */
  readonly org: string;
  /** The server, from the plugin's `status.mcp_servers`. */
  readonly server: McpServerEntry;
  /** Called with the address when a sign-in started from this cell lands. */
  readonly onSignedIn?: (address: string) => void;
  readonly className?: string;
}

/**
 * Renders {@link usePluginServerSignIn} for one server.
 *
 * @example
 * ```tsx
 * <PluginServerSignIn org="acme" server={plugin.status.mcpServers[0]} />
 * ```
 */
export function PluginServerSignIn({ org, server, onSignedIn, className }: PluginServerSignInProps) {
  const signIn = usePluginServerSignIn(org, server, onSignedIn);
  return <PluginServerSignInView name={server.name} signIn={signIn} className={className} />;
}

function PluginServerSignInView({
  name,
  signIn,
  className,
}: {
  readonly name: string;
  readonly signIn: UsePluginServerSignInReturn;
  readonly className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const root = cn("stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:justify-end stg:gap-2 stg:text-xs", className);
  const failure = signIn.error && (
    <span role="alert" className="stg:text-destructive">
      {signIn.error.message}
    </span>
  );
  switch (signIn.kind) {
    case "loading":
      return (
        <span className={cn(root, "stg:text-muted-foreground")} role="status">
          Reading…
        </span>
      );
    case "unreadable":
      return (
        <span className={cn(root, "stg:text-destructive")} role="status">
          {signIn.error?.message ?? "Your vault could not be read."}
        </span>
      );
    case "signed-in":
      if (confirming) {
        return (
          <span className={root}>
            <span className="stg:text-foreground">Sign out of {name}? Its login is removed from My vault.</span>
            <Button
              variant="destructive"
              size="xs"
              disabled={signIn.isSigningOut}
              onClick={() => {
                void signIn.signOut().then(
                  () => setConfirming(false),
                  () => undefined,
                );
              }}
            >
              {signIn.isSigningOut ? "Signing out…" : "Sign out"}
            </Button>
            <Button variant="ghost" size="xs" disabled={signIn.isSigningOut} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            {failure}
          </span>
        );
      }
      return (
        <span className={root}>
          <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-success" role="status">
            <Dot className="stg:bg-success" />
            Signed in
          </span>
          {signIn.connection !== null && (
            <Button variant="ghost" size="xs" onClick={() => setConfirming(true)} aria-label={`Sign out of ${name}`}>
              Sign out
            </Button>
          )}
          {failure}
        </span>
      );
    case "sign-in-needed":
      return (
        <span className={root}>
          {failure}
          {!signIn.isSigningIn && (
            <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-muted-foreground">
              <Dot className="stg:bg-muted-foreground" />
              Not signed in
            </span>
          )}
          <Button variant="primary" size="sm" onClick={signIn.signIn} disabled={signIn.isSigningIn} aria-label={`Sign in to ${name}`}>
            {signIn.isSigningIn ? phaseLabel(signIn.phase) : "Sign in"}
          </Button>
        </span>
      );
    case "api-key":
      return (
        <span className={cn(root, "stg:text-muted-foreground")}>
          Needs <code className="stg:font-mono stg:text-foreground">{signIn.declaredVariables.join(", ")}</code>; asked for when a
          conversation that uses it starts.
        </span>
      );
    case "open":
      return null;
    default: {
      const exhaustive: never = signIn.kind;
      return exhaustive;
    }
  }
}

/** The busy label for a sign-in's phase. */
export function phaseLabel(phase: VaultSignInPhase): string {
  switch (phase) {
    case "starting":
      return "Starting sign-in…";
    case "awaiting-callback":
      return "Waiting for sign-in…";
    case "completing":
      return "Completing sign-in…";
    case "idle":
    case "done":
      return "Sign in";
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

function Dot({ className }: { readonly className: string }) {
  return <span aria-hidden="true" className={cn("stg:inline-block stg:size-2 stg:rounded-full", className)} />;
}
