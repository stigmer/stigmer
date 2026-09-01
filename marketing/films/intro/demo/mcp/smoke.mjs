#!/usr/bin/env node
/**
 * Smoke test for meridian-ops: spawns the real server over stdio (exactly
 * how the Stigmer runner does) and proves the film's three on-camera
 * facts — the toolset, a deterministic search, and the rebooking that the
 * approval gate protects. Run with: npm run demo:smoke
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));

const client = new Client({ name: "meridian-ops-smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: [join(here, "meridian-ops.mjs")] }),
);

const parse = (result) => {
  assert.equal(result.isError ?? false, false, `tool errored: ${JSON.stringify(result.content)}`);
  return JSON.parse(result.content[0].text);
};

// The toolset the agent YAML enables must be exactly what the server reports.
const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  ["get_booking", "rebook_booking", "search_flights"],
  "tools/list must report exactly the three film tools",
);

// The chat scene opens by resolving the traveler's booking.
const booking = parse(
  await client.callTool({ name: "get_booking", arguments: { booking_id: "MT-4821" } }),
);
assert.equal(booking.route, "SFO-JFK");
assert.equal(booking.fare_class, "flex");
assert.equal(booking.traveler, "Priya Shah");

// Deterministic search: same inputs, same three options, every take.
const search = parse(
  await client.callTool({
    name: "search_flights",
    arguments: { origin: "SFO", destination: "JFK", date: "2026-09-11" },
  }),
);
assert.equal(search.options.length, 3);
assert.equal(search.options[0].flight_number, "MT-102");
assert.equal(search.options[0].departs, "07:05");

// The hero rebooking: MT-4821 (flex fare, $300 paid) onto the 07:05 —
// $42 fare difference, no change fee, per rebooking-policy §2.
const rebook = parse(
  await client.callTool({
    name: "rebook_booking",
    arguments: { booking_id: "MT-4821", flight_number: "MT-102", date: "2026-09-11" },
  }),
);
assert.equal(rebook.status, "confirmed");
assert.equal(rebook.fare_difference_usd, 42);
assert.equal(rebook.change_fee_usd, 0);
assert.equal(rebook.total_charge_usd, 42);

// Failure paths answer with structured errors, not crashes.
const badRoute = await client.callTool({
  name: "search_flights",
  arguments: { origin: "SFO", destination: "LAX", date: "2026-09-11" },
});
assert.equal(badRoute.isError, true);
const badBooking = await client.callTool({
  name: "rebook_booking",
  arguments: { booking_id: "MT-0000", flight_number: "MT-102", date: "2026-09-11" },
});
assert.equal(badBooking.isError, true);

await client.close();
console.log("meridian-ops smoke: OK (tools/list, deterministic search, rebooking math, error paths)");
