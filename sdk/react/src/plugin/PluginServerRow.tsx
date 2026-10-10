"use client";

/**
 * One of a plugin's MCP servers as the plugin page lists it: its name, how
 * it is reached (an address, or the program the runner starts), its
 * sign-in cell (`PluginServerSignIn`), and "Check tools", which asks the
 * server for its tools now (`usePluginTools`) and lists each by name with
 * what it does and whether the server marks it destructive.
 *
 * The tool names a turn uses are `mcp__plugin_<plugin>_<server>__<tool>`;
 * the row shows the server segment once, under the server's name, rather
 * than prefixing every tool with it.
 */

import { cn } from "@stigmer/theme";
import { toolServerSegment } from "@stigmer/plugin-package";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { Button } from "../button/Button.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { PluginServerSignIn } from "./PluginServerSignIn.js";
import { usePluginTools } from "./usePluginTools.js";

/** Props for {@link PluginServerRow}. */
export interface PluginServerRowProps {
  /** The organization the plugin is used in: its runner lists the tools, and My vault there holds the login. */
  readonly org: string;
  /** The plugin's id, for the tools listing. */
  readonly pluginId: string;
  /** The plugin's name, as a turn names its tools. */
  readonly pluginName: string;
  readonly server: McpServerEntry;
}

/** One plugin server: how it is reached, its sign-in, and its tools on demand. */
export function PluginServerRow({ org, pluginId, pluginName, server }: PluginServerRowProps) {
  const tools = usePluginTools(pluginId, server.name, org);
  return (
    <li className="stg:flex stg:min-w-0 stg:flex-col stg:gap-2 stg:px-3 stg:py-2.5">
      <div className="stg:flex stg:flex-wrap stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:flex stg:min-w-0 stg:flex-col stg:gap-0.5">
          <span className="stg:text-sm stg:font-medium stg:text-foreground">{server.name}</span>
          <span className="stg:break-all stg:font-mono stg:text-xs stg:text-muted-foreground">{reachedBy(server)}</span>
          <span className="stg:font-mono stg:text-xs stg:text-muted-foreground-faint">
            mcp__{toolServerSegment(pluginName, server.name)}__*
          </span>
        </div>
        <div className="stg:flex stg:shrink-0 stg:flex-wrap stg:items-center stg:justify-end stg:gap-2">
          <PluginServerSignIn org={org} server={server} />
          <Button variant="outline" size="xs" onClick={() => void tools.check()} disabled={tools.isChecking}>
            {tools.isChecking ? "Checking…" : "Check tools"}
          </Button>
        </div>
      </div>
      {tools.error && (
        <p role="alert" className="stg:text-xs stg:text-destructive">
          {tools.error.message}
        </p>
      )}
      {tools.tools !== null &&
        (tools.tools.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">The server lists no tools.</p>
        ) : (
          <ul
            className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border")}
            aria-label={`Tools of ${server.name}`}
          >
            {tools.tools.map((tool) => (
              <li key={tool.name} className="stg:flex stg:flex-col stg:gap-0.5 stg:px-2.5 stg:py-1.5">
                <span className="stg:flex stg:items-center stg:gap-2">
                  <span className="stg:font-mono stg:text-xs stg:text-foreground">{tool.name}</span>
                  {tool.destructive && (
                    <span className="stg:rounded stg:border stg:border-destructive stg:px-1 stg:text-xs stg:text-destructive">Destructive</span>
                  )}
                </span>
                {tool.description && <span className="stg:text-xs stg:text-muted-foreground">{tool.description}</span>}
              </li>
            ))}
          </ul>
        ))}
    </li>
  );
}

/** How a server is reached, in one line: its URL, or the program and its arguments. */
export function reachedBy(server: McpServerEntry): string {
  const transport = server.transport;
  switch (transport.case) {
    case "http":
      return transport.value.url;
    case "stdio":
      return [transport.value.command, ...transport.value.args].join(" ");
    case undefined:
      return "";
    default: {
      const exhaustive: never = transport;
      return exhaustive;
    }
  }
}
