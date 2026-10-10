// Renders a `connect plugin` result to the terminal: the plugin and the
// server, how the server is reached, each tool with its description and a
// mark on the ones the server calls destructive (a turn asks a person before
// calling those), and a line saying where the list came from. Nothing is
// stored either way, so the last line says so.

import { styler } from "../../output/style.js";
import { serverTransport } from "../plugin.js";
import type { ConnectResult } from "./connect.js";

/** A sink for one display line (no trailing newline). */
export type ConnectSink = (line: string) => void;

const NAME_COLUMN = 30;
const DESTRUCTIVE_MARK = "[destructive]";

/**
 * `orgLabel` names the plugin's organization (its slug, in place of the id
 * the plugin carries); undefined leaves it out, as on a server that holds
 * one organization, which never names it.
 */
export function renderConnectResult(
  result: ConnectResult,
  sink: ConnectSink,
  colorize: boolean,
  orgLabel?: string,
): void {
  const style = styler(colorize);
  const name = result.plugin.metadata?.slug || result.plugin.spec?.name || "";

  sink("");
  sink(style.cyan(`Plugin:     ${orgLabel === undefined ? name : `${orgLabel}/${name}`}`));
  sink(`MCP server: ${result.server.name} (${reachedBy(result)})`);
  sink("");

  sink(`Tools (${result.tools.length}):`);
  if (result.tools.length === 0) sink("  (none)");
  for (const tool of result.tools) {
    const mark = tool.destructive ? `${style.yellow(DESTRUCTIVE_MARK)} ` : "";
    sink(mark === "" && tool.description === "" ? `  ${tool.name}` : `  ${pad(tool.name)} ${mark}${tool.description}`.trimEnd());
  }
  sink("");

  sink(
    result.dryRun
      ? style.yellow("⚠ Dry run: listed from this machine; nothing stored")
      : style.green("✓ Listed as you; nothing stored"),
  );
  sink("");
}

function reachedBy(result: ConnectResult): string {
  const transport = result.server.transport;
  switch (transport.case) {
    case "stdio":
      return `${serverTransport(result.server)}: ${[transport.value.command, ...transport.value.args].join(" ")}`;
    case "http":
      return `${serverTransport(result.server)}: ${transport.value.url}`;
    case undefined:
      return serverTransport(result.server);
    default: {
      const exhaustive: never = transport;
      return String(exhaustive);
    }
  }
}

// Left-justify a name to the fixed column width.
function pad(name: string): string {
  return name.length >= NAME_COLUMN ? name : name + " ".repeat(NAME_COLUMN - name.length);
}
