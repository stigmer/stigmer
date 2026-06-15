// Renders a connect result to the terminal. Port of Go's DisplayConnectResult
// (connect_display.go): server identity + transport, the discovered tools and
// resource templates, and a saved-vs-dry-run status line.

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { styler } from "../../output/style.js";
import type { ConnectResult } from "./connect.js";

/** A sink for one display line (no trailing newline). */
export type ConnectSink = (line: string) => void;

const NAME_COLUMN = 30;

export function renderConnectResult(result: ConnectResult, sink: ConnectSink, colorize: boolean): void {
  const style = styler(colorize);
  const meta = result.server.metadata;

  sink("");
  sink(style.cyan(`MCP Server: ${meta?.org ?? ""}/${meta?.name ?? ""}`));
  sink(transportLine(result.server));
  sink("");

  renderTools(result, sink);
  renderResourceTemplates(result, sink);

  sink(result.updated !== undefined
    ? style.green("✓ Connected — capabilities and tool approvals saved")
    : style.yellow("⚠ Dry run — results not saved to backend"));
  sink("");
}

function transportLine(server: McpServer): string {
  const serverType = server.spec?.serverType;
  if (serverType?.case === "stdio") return `Transport:  stdio (${serverType.value.command})`;
  if (serverType?.case === "http") return `Transport:  http (${serverType.value.url})`;
  return "Transport:  (unknown)";
}

function renderTools(result: ConnectResult, sink: ConnectSink): void {
  const tools = result.capabilities?.tools ?? [];
  sink(`Tools (${tools.length}):`);
  if (tools.length === 0) {
    sink("  (none)");
  } else {
    for (const tool of tools) {
      sink(tool.description !== "" ? `  ${pad(tool.name)} ${tool.description}` : `  ${tool.name}`);
    }
  }
  sink("");
}

function renderResourceTemplates(result: ConnectResult, sink: ConnectSink): void {
  const templates = result.capabilities?.resourceTemplates ?? [];
  sink(`Resource Templates (${templates.length}):`);
  if (templates.length === 0) {
    sink("  (none)");
  } else {
    for (const template of templates) {
      sink(`  ${pad(template.name)} ${template.uriTemplate}`);
    }
  }
  sink("");
}

// Left-justify a name to the fixed column width, mirroring Go's "%-30s".
function pad(name: string): string {
  return name.length >= NAME_COLUMN ? name : name + " ".repeat(NAME_COLUMN - name.length);
}
