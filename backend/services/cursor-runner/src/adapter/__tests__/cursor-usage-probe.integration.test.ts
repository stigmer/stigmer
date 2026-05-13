/**
 * Probe: what does the Cursor SDK actually return for usage?
 *
 * Makes a real Cursor SDK call and logs every onDelta update and every
 * stream event so we can see exactly what usage data is available.
 *
 * Run:
 *   CURSOR_API_KEY=crsr_... npx vitest run src/adapter/__tests__/cursor-usage-probe.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { Agent } from "@cursor/sdk";

const API_KEY = process.env.CURSOR_API_KEY;
const SKIP = !API_KEY;
const TIMEOUT = 120_000;

describe.skipIf(SKIP)("cursor-usage-probe (real Cursor API)", () => {
  it("logs all onDelta updates and stream events with full detail", async () => {
    const agent = await Agent.create({
      apiKey: API_KEY!,
      model: { id: "default" },
      workspaceDirs: ["/tmp/stigmer-usage-probe"],
    });

    console.log(`\n${"=".repeat(72)}`);
    console.log(`Agent created: ${agent.agentId}`);
    console.log(`${"=".repeat(72)}\n`);

    const deltaUpdates: unknown[] = [];

    const run = await agent.send(
      "What is the capital of France? Reply in one sentence.",
      {
        onDelta: ({ update }) => {
          deltaUpdates.push(update);

          if (update.type === "turn-ended") {
            console.log(`\n>>> onDelta: turn-ended`);
            console.log(`    usage present: ${!!update.usage}`);
            if (update.usage) {
              console.log(`    usage: ${JSON.stringify(update.usage, null, 2)}`);
            }
            console.log(`    full update: ${JSON.stringify(update, null, 2)}`);
          } else if (update.type === "token-delta") {
            console.log(
              `>>> onDelta: token-delta tokens=${JSON.stringify((update as any).tokens)}`,
            );
          } else {
            console.log(
              `>>> onDelta: type=${update.type}`,
            );
          }
        },
      },
    );

    console.log(`\n--- Stream events ---`);
    const streamEvents: unknown[] = [];
    let eventIdx = 0;

    for await (const event of run.stream()) {
      streamEvents.push(event);
      const e = event as any;

      if (e.type === "text") {
        eventIdx++;
        continue;
      }

      console.log(
        `[${eventIdx}] stream event: type=${e.type} ${JSON.stringify(e).slice(0, 300)}`,
      );
      eventIdx++;
    }

    const result = await run.wait();

    console.log(`\n${"=".repeat(72)}`);
    console.log(`Run completed: status=${result.status}`);
    console.log(`Total onDelta updates: ${deltaUpdates.length}`);
    console.log(`Total stream events: ${streamEvents.length}`);

    const deltaTypes = [
      ...new Set(deltaUpdates.map((d: any) => d.type)),
    ];
    console.log(`Delta update types seen: ${JSON.stringify(deltaTypes)}`);

    console.log(`\nRunResult keys: ${Object.keys(result)}`);
    console.log(`RunResult: ${JSON.stringify(result, null, 2)}`);

    const turnEndedDeltas = deltaUpdates.filter(
      (d: any) => d.type === "turn-ended",
    );
    console.log(`\n--- turn-ended deltas (${turnEndedDeltas.length}) ---`);
    for (const d of turnEndedDeltas) {
      console.log(JSON.stringify(d, null, 2));
    }

    const withUsage = deltaUpdates.filter((d: any) => d.usage);
    console.log(`\n--- deltas with usage field (${withUsage.length}) ---`);
    for (const d of withUsage) {
      console.log(JSON.stringify(d, null, 2));
    }

    const withModel = deltaUpdates.filter((d: any) => d.model);
    console.log(`\n--- deltas with model field (${withModel.length}) ---`);
    for (const d of withModel) {
      console.log(JSON.stringify(d, null, 2));
    }

    console.log(`${"=".repeat(72)}\n`);

    expect(result.status).toBe("finished");
    expect(streamEvents.length).toBeGreaterThan(0);
  }, TIMEOUT);
});
