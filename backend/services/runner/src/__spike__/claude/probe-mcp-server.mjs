#!/usr/bin/env node
/*
 * The spike's stdio MCP server: two tools, no dependencies, newline-delimited
 * JSON-RPC on stdin and stdout as the MCP stdio transport speaks it.
 *
 *  - `destroy` stands in for a destructive tool Stigmer gates by default. It
 *    appends one line to the call log named by PROBE_MCP_LOG for every call it
 *    executes, so a probe can prove a gated call did or did not run.
 *  - `dump_env` returns this process's environment and, on Linux, every
 *    ancestor's `/proc/<pid>/environ` it can read: what a third-party server
 *    started by the engine can see (the environment probe). Values are returned raw; the
 *    probe masks them before anything is written to evidence.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.PROBE_MCP_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ event: "started", pid: process.pid, at: Date.now() })}\n`);

const startDelayMs = Number(process.env.PROBE_MCP_START_DELAY_MS ?? "0");

function ancestors() {
  const out = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 12 && pid > 1; depth += 1) {
    const entry = { pid };
    try {
      entry.cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
    } catch (error) {
      entry.cmdline = `unreadable: ${error.code ?? error.message}`;
    }
    try {
      entry.environ = Object.fromEntries(
        readFileSync(`/proc/${pid}/environ`, "utf8")
          .split("\0")
          .filter(Boolean)
          .map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
      );
    } catch (error) {
      entry.environ = `unreadable: ${error.code ?? error.message}`;
    }
    out.push(entry);
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      pid = Number(/PPid:\s+(\d+)/.exec(status)?.[1] ?? "0");
    } catch {
      break;
    }
  }
  return out;
}

const tools = [
  {
    name: "destroy",
    description: "Destroys the named target. Destructive.",
    inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    annotations: { destructiveHint: true },
  },
  {
    name: "dump_env",
    description: "Returns this server's environment and its ancestors'.",
    inputSchema: { type: "object", properties: {} },
  },
];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

async function handle(message) {
  if (message.id === undefined) return;
  switch (message.method) {
    case "initialize":
      if (startDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, startDelayMs));
      reply(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "probe", version: "0.0.0" },
      });
      return;
    case "tools/list":
      reply(message.id, { tools });
      return;
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (log) appendFileSync(log, `${JSON.stringify({ event: "call", name, args, at: Date.now() })}\n`);
      if (name === "destroy") {
        reply(message.id, { content: [{ type: "text", text: `destroyed ${args.target}` }] });
        return;
      }
      if (name === "dump_env") {
        const dump = { pid: process.pid, uid: process.getuid?.(), env: process.env, ancestors: ancestors() };
        if (process.env.PROBE_MCP_DUMP) {
          // Written to a file only, so no raw value travels to the model (and the mock's log).
          writeFileSync(process.env.PROBE_MCP_DUMP, JSON.stringify(dump));
          reply(message.id, { content: [{ type: "text", text: "dumped" }] });
          return;
        }
        reply(message.id, { content: [{ type: "text", text: JSON.stringify(dump) }] });
        return;
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `no tool ${name}` } })}\n`);
      return;
    }
    default:
      reply(message.id, {});
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch {
    // A malformed line is ignored; the client times the call out.
  }
});
