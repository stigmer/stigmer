"use client";

/**
 * The servers of the plugins a conversation lists that sign in, each with
 * its sign-in cell, so a person can sign in before the first message
 * rather than meet the refusal at the first tool call.
 *
 * Each listed plugin is read once (`usePlugin`); only its HTTP servers
 * marked to sign in get a row, because a key-taking server is asked for
 * by the run's own key check and an open one needs nothing. A plugin that
 * cannot be read says so in its row; one that is gone says the
 * conversation will be refused for it, which is what the server does with
 * a reference it cannot resolve. Renders nothing when no listed plugin
 * has a server that signs in.
 */

import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { PluginServerSignIn } from "./PluginServerSignIn.js";
import { usePlugin } from "./usePlugin.js";

/** Props for {@link PluginServerSignIns}. */
export interface PluginServerSignInsProps {
  /** The organization the conversation runs in; a reference without an org belongs to it. */
  readonly org: string;
  /** The plugins the conversation lists. */
  readonly plugins: readonly ResourceRef[];
  /** Called with the address when a sign-in started here lands. */
  readonly onSignedIn?: (address: string) => void;
  readonly className?: string;
}

/** Lists the sign-ins the listed plugins' servers need, one row per server that signs in. */
export function PluginServerSignIns({ org, plugins, onSignedIn, className }: PluginServerSignInsProps) {
  if (plugins.length === 0) return null;
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1", className)} aria-label="Plugin sign-ins">
      {plugins.map((ref) => (
        <PluginRows key={`${ref.org}/${ref.slug}`} pluginOrg={ref.org || org} slug={ref.slug} org={org} onSignedIn={onSignedIn} />
      ))}
    </ul>
  );
}

function PluginRows({
  pluginOrg,
  slug,
  org,
  onSignedIn,
}: {
  readonly pluginOrg: string;
  readonly slug: string;
  /** The conversation's organization, whose My vault holds the logins. */
  readonly org: string;
  readonly onSignedIn?: (address: string) => void;
}) {
  const { plugin, isLoading, error } = usePlugin(pluginOrg, slug);
  if (isLoading) return null;
  if (error) {
    return (
      <li role="note" className="stg:text-xs stg:text-muted-foreground">
        The plugin {slug} could not be read.
      </li>
    );
  }
  if (plugin === null) {
    return (
      <li role="note" className="stg:text-xs stg:text-destructive">
        The plugin {slug} is not installed; a conversation that lists it is refused.
      </li>
    );
  }
  const name = plugin.metadata?.name || slug;
  const servers = (plugin.status?.mcpServers ?? []).filter(
    (server) => server.transport.case === "http" && server.signIn !== undefined,
  );
  return (
    <>
      {servers.map((server) => (
        <li key={server.name} className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2">
          <span className="stg:text-xs stg:font-medium stg:text-foreground">
            {name === server.name ? name : `${name} · ${server.name}`}
          </span>
          <PluginServerSignIn org={org} server={server} onSignedIn={onSignedIn} />
        </li>
      ))}
    </>
  );
}
