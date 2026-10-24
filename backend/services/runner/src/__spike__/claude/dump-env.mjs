#!/usr/bin/env node
/*
 * Writes what a process the agent's shell starts can see: its own
 * environment and, on Linux, every ancestor's /proc/<pid>/environ it can
 * read, to the file named by its first argument (the environment probe). Raw values;
 * the probe masks them before anything reaches evidence.
 */

import { readFileSync, writeFileSync } from "node:fs";

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
      pid = Number(/PPid:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? "0");
    } catch {
      break;
    }
  }
  return out;
}

writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, uid: process.getuid?.(), env: process.env, ancestors: ancestors() }));
