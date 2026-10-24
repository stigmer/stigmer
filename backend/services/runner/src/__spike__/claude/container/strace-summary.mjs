#!/usr/bin/env node
/*
 * Reads q4's raw strace (execve, connect, sendto, sendmsg across the whole
 * process tree) and lists every socket the engine's processes opened: the
 * engine is every process that exec'd the claude binary, and its
 * descendants. Prints loopback and non-loopback connects and any DNS sign.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
const lines = readFileSync(input, "utf8").split("\n").filter(Boolean);
const parent = new Map();
const engine = new Set();
for (const line of lines) {
  const m = /^(\d+)\s+(.*)$/.exec(line);
  if (!m) continue;
  const [, pid, rest] = m;
  const clone = /(?:clone|clone3|vfork|fork)\(.*\)\s*=\s*(\d+)/.exec(rest);
  if (clone) parent.set(clone[1], pid);
  if (/^execve\("[^"]*claude[^"]*"/.test(rest) && !/= -1/.test(rest)) engine.add(pid);
}
// strace -f without clone tracing names a child the first time it appears; a
// pid whose first line follows an engine pid's exec is attributed by -f order,
// so every pid seen after an engine exec that is not a known non-engine is kept
// as a candidate and the full list is printed for reading.
const connects = [];
for (const line of lines) {
  const m = /^(\d+)\s+(connect|sendto|sendmsg)\((.*)$/.exec(line);
  if (!m) continue;
  const [, pid, call, rest] = m;
  const inet = /sin6?_addr=inet_(?:addr|pton)\((?:AF_INET6?, )?"([^"]+)"\)/.exec(rest);
  const port = /sin6?_port=htons\((\d+)\)/.exec(rest);
  const unix = /sun_path="([^"]+)"/.exec(rest);
  connects.push({ pid, call, engine: engine.has(pid), addr: inet?.[1] ?? (unix ? `unix:${unix[1]}` : null), port: port ? Number(port[1]) : null, raw: rest.slice(0, 160) });
}
const sockets = connects.filter((c) => c.addr !== null);
const nonLoopback = sockets.filter((c) => !c.addr.startsWith("unix:") && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(c.addr));
const dns = sockets.filter((c) => c.port === 53 || (c.addr ?? "").includes("nscd") || (c.addr ?? "").includes("resolve"));
const summary = { enginePids: [...engine], socketCalls: sockets.length, nonLoopback, dns, byAddress: Object.entries(sockets.reduce((acc, c) => ((acc[`${c.addr}:${c.port}`] = (acc[`${c.addr}:${c.port}`] ?? 0) + 1), acc), {})) };
writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ enginePids: summary.enginePids, socketCalls: summary.socketCalls, nonLoopback: nonLoopback.length, dns: dns.length }));
