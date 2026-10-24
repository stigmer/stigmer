#!/usr/bin/env node
/*
 * The message tally: every SDK message type seen across all probes' message
 * logs (`*.messages.jsonl`), with a count, the files it appeared in and one
 * example's keys; and, from the adapter's traces (`adapter-*.trace.jsonl`),
 * which transcript events each message type became. Rows with no event are
 * the "no counterpart" candidates the write-up reasons about.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const out = process.argv[3];
const key = (m) => {
  if (m.type === "stream_event") return `stream_event/${m.event?.type ?? "?"}${m.event?.delta?.type ? `/${m.event.delta.type}` : ""}`;
  if (m.type === "system" || m.type === "result") return `${m.type}/${m.subtype ?? "?"}`;
  if (m.type === "user") return `user/${typeof m.message?.content === "string" ? "text" : (m.message?.content ?? []).map((b) => b.type).join("+")}${m.isSynthetic ? "/synthetic" : ""}${m.parent_tool_use_id ? "/in-subagent" : ""}`;
  if (m.type === "assistant") return `assistant/${(m.message?.content ?? []).map((b) => b.type).join("+")}${m.parent_tool_use_id ? "/in-subagent" : ""}`;
  return m.type ?? "?";
};
const table = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".messages.jsonl"))) {
  for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
    const m = JSON.parse(line);
    if (m.thrown) continue;
    const k = key(m);
    const row = table.get(k) ?? { count: 0, files: new Set(), exampleKeys: Object.keys(m).sort() };
    row.count += 1;
    row.files.add(f.replace(".messages.jsonl", ""));
    table.set(k, row);
  }
}
const mapped = new Map();
for (const f of readdirSync(dir).filter((f) => /^adapter-.*\.trace\.jsonl$/.test(f))) {
  for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
    const t = JSON.parse(line);
    if (!t.message) continue;
    const k = key(t.message);
    const set = mapped.get(k) ?? new Set();
    for (const e of t.events ?? []) set.add(e.kind);
    if ((t.events ?? []).length === 0) set.add("(none)");
    mapped.set(k, set);
  }
}
const rows = [...table.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([k, r]) => ({ type: k, count: r.count, inFiles: [...r.files].slice(0, 6), exampleKeys: r.exampleKeys, adapterEvents: mapped.has(k) ? [...mapped.get(k)] : "not seen through the adapter" }));
writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(rows.map((r) => `${r.type}\t${r.count}\t${Array.isArray(r.adapterEvents) ? r.adapterEvents.join(",") : r.adapterEvents}`).join("\n"));
