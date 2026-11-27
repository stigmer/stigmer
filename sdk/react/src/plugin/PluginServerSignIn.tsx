"use client";

/**
 * One plugin server's sign-in, rendered as a cell: a status dot and a
 * word, a Sign in button when a sign-in is what stands between the server
 * and its first tool call, Sign out beside a login saved at its address,
 * one sentence when a key does. A login made by signing in also offers
 * Sign in again, which replaces it: the way back from a login the server
 * has since expired or revoked.
 *
 * Three surfaces render it and must say the same thing: the plugin's
 * page, beside each MCP server; the session composer, for a server of the
 * agent's plugins nobody has signed in to yet; and the agent's page,
 * beside each MCP server the agent writes itself, where a sign-in is
 * offered quietly rather than owed (`optionalSignIn`). All state lives in
 * `usePluginServerSignIn`; this file only renders it. Signing out asks
 * once inline, as removing any vault entry does, because the login cannot
 * be read back.
 *
 * While a sign-in waits, the cell offers Cancel beside the busy label: the
 * wait lasts until the server's ten-minute life of a sign-in, so a window
 * closed by mistake must never leave the row stuck.
 *
 * The owed sign-in's look is {@link SignInNeededCell}, which the
 * composer's row for a run that never reads My vault renders too (it saves
 * into a shared vault instead), so the two never drift apart. The cell is
 * the kit's own and not exported from its barrel.
 */

import { useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { Button } from "../button/Button.js";
import { StatusBadge } from "../status/StatusBadge.js";
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
  /**
   * Offer a sign-in to a server with no sign-in record that sends no
   * `Authorization` header (an agent's own server); see
   * {@link usePluginServerSignIn}.
   * @default false
   */
  readonly optionalSignIn?: boolean;
  /**
   * Where the page offers to save a key the server reads: the plugin page
   * lists its keys below the servers, each with Save to My vault, so the
   * key-taking row says "Save it below". Elsewhere the row says the key is
   * asked for when a conversation starts.
   * @default false
   */
  readonly keysSavedBelow?: boolean;
  readonly className?: string;
}

/**
 * Renders {@link usePluginServerSignIn} for one server.
 *
 * @example
 * ```tsx
 * import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
 *
 * function ServerSignIns({ plugin }: { plugin: Plugin }) {
 *   return plugin.status?.mcpServers.map((server) => <PluginServerSignIn key={server.name} org="acme" server={server} />) ?? null;
 * }
 * ```
 */
export function PluginServerSignIn({
  org,
  server,
  onSignedIn,
  optionalSignIn = false,
  keysSavedBelow = false,
  className,
}: PluginServerSignInProps) {
  const signIn = usePluginServerSignIn(org, server, onSignedIn, { optionalSignIn });
  return <PluginServerSignInView name={server.name} signIn={signIn} keysSavedBelow={keysSavedBelow} className={className} />;
}

/** Every state of the cell sits in one right-aligned, wrapping row. */
const CELL = "stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:justify-end stg:gap-2 stg:text-xs";

function PluginServerSignInView({
  name,
  signIn,
  keysSavedBelow,
  className,
}: {
  readonly name: string;
  readonly signIn: UsePluginServerSignInReturn;
  readonly keysSavedBelow: boolean;
  readonly className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const root = cn(CELL, className);
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
          <span className="stg:inline-flex" role="status">
            <StatusBadge phase="ready" label="Signed in" />
          </span>
          {signIn.canSignInAgain && (
            <Button
              variant="ghost"
              size="xs"
              onClick={signIn.signInAgain}
              disabled={signIn.isSigningIn}
              aria-label={`Sign in again to ${name}`}
            >
              {signIn.isSigningIn ? phaseLabel(signIn.phase) : "Sign in again"}
            </Button>
          )}
          {signIn.isSigningIn && <CancelSignIn name={name} onCancel={signIn.cancelSignIn} />}
          {signIn.connection !== null && !signIn.isSigningIn && (
            <Button variant="ghost" size="xs" onClick={() => setConfirming(true)} aria-label={`Sign out of ${name}`}>
              Sign out
            </Button>
          )}
          {failure}
        </span>
      );
    case "sign-in-needed":
      return (
        <SignInNeededCell
          name={name}
          isSigningIn={signIn.isSigningIn}
          phase={signIn.phase}
          error={signIn.error}
          onSignIn={signIn.signIn}
          onCancel={signIn.cancelSignIn}
          className={className}
        />
      );
    case "sign-in-available":
      return (
        <span className={cn(root, "stg:text-muted-foreground")}>
          {failure}
          <span>Sign in only if this server asks for one.</span>
          <Button variant="ghost" size="xs" onClick={signIn.signIn} disabled={signIn.isSigningIn} aria-label={`Sign in to ${name}`}>
            {signIn.isSigningIn ? phaseLabel(signIn.phase) : "Sign in"}
          </Button>
          {signIn.isSigningIn && <CancelSignIn name={name} onCancel={signIn.cancelSignIn} />}
        </span>
      );
    case "api-key":
      return (
        <span className={cn(root, "stg:text-muted-foreground")}>
          Needs <code className="stg:font-mono stg:text-foreground">{signIn.declaredVariables.join(", ")}</code>
          {keysSavedBelow
            ? ". Save it below, or paste it when a conversation that uses it asks."
            : "; asked for when a conversation that uses it starts."}
        </span>
      );
    case "open":
      return null;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over PluginServerSignInKind; the hook answers only the arms above */
    default: {
      const exhaustive: never = signIn.kind;
      return exhaustive;
    }
  }
}

/** Cancel beside a waiting sign-in: ends the wait and closes its window. */
function CancelSignIn({ name, onCancel }: { readonly name: string; readonly onCancel: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onCancel} aria-label={`Cancel the sign-in to ${name}`}>
      Cancel
    </Button>
  );
}

/**
 * A sign-in that stands between a server and its first tool call: the
 * failure of the last try, "Not signed in", and Sign in (its phase while
 * one runs, with Cancel beside it). The one look for every owed sign-in,
 * wherever it saves.
 */
export function SignInNeededCell({
  name,
  isSigningIn,
  phase,
  error,
  onSignIn,
  onCancel,
  className,
}: {
  /** The server's name, for the button's accessible name. */
  readonly name: string;
  readonly isSigningIn: boolean;
  readonly phase: VaultSignInPhase;
  /** The last sign-in's failure, or `null`. */
  readonly error: Error | null;
  /** Starts the sign-in; called from the click, so a popup may open before any await. */
  readonly onSignIn: () => void;
  /** Cancels a sign-in in progress: the wait ends and its window closes. */
  readonly onCancel: () => void;
  readonly className?: string;
}) {
  return (
    <span className={cn(CELL, className)}>
      {error && (
        <span role="alert" className="stg:text-destructive">
          {error.message}
        </span>
      )}
      {!isSigningIn && <StatusBadge phase="disabled" label="Not signed in" />}
      <Button variant="primary" size="sm" onClick={onSignIn} disabled={isSigningIn} aria-label={`Sign in to ${name}`}>
        {isSigningIn ? phaseLabel(phase) : "Sign in"}
      </Button>
      {isSigningIn && <CancelSignIn name={name} onCancel={onCancel} />}
    </span>
  );
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
    /* v8 ignore next -- @preserve: the exhaustiveness guard over VaultSignInPhase; useVaultSignIn reports only the arms above */
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
