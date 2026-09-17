"use client";

/**
 * "Installed by a plugin": the one sentence a skill, server or agent page
 * shows when a plugin owns the resource, in place of an edit form the
 * server would refuse.
 *
 * The rule it states is the plugin model's: a plugin's resources are the
 * plugin's to redefine, so you change the plugin and push it again, or
 * compose your own agent over its skills and servers. The notice names the
 * plugin and, through a callback, links to its page; it renders nothing
 * when the resource is nobody's.
 */

import { cn } from "@stigmer/theme";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginIcon } from "./PluginIcon.js";

/** Props for {@link ManagedByPluginNotice}. */
export interface ManagedByPluginNoticeProps {
  /** The plugin that installed the resource; `null` renders nothing. */
  readonly plugin: Plugin | null;
  /** Called when the plugin's name is selected; the host owns the route to the plugin's page. */
  readonly onPluginClick?: (ref: { org: string; slug: string }) => void;
  readonly className?: string;
}

/** States that a resource was installed by a plugin and is changed by pushing the plugin again. */
export function ManagedByPluginNotice({ plugin, onPluginClick, className }: ManagedByPluginNoticeProps) {
  if (plugin === null) return null;
  const meta = plugin.metadata;
  const name = meta?.name || meta?.slug || "a plugin";
  const ref = meta ? { org: meta.org, slug: meta.slug } : null;
  return (
    <div
      role="note"
      className={cn(
        "stg:flex stg:items-start stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
        className,
      )}
    >
      <PluginIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
      <p>
        Installed by the plugin{" "}
        {onPluginClick && ref ? (
          <button
            type="button"
            onClick={() => onPluginClick(ref)}
            className="stg:cursor-pointer stg:font-medium stg:underline stg:decoration-dotted stg:underline-offset-2 stg:hover:text-primary"
          >
            {name}
          </button>
        ) : (
          <span className="stg:font-medium">{name}</span>
        )}
        . To change it, change the plugin and push it again; to customise, compose your own agent over its skills and
        servers.
      </p>
    </div>
  );
}
