#!/usr/bin/env node
/**
 * Capture CLI: `node films/intro/capture/capture.mjs <shot-id...|all>`
 * (or `npm run capture -- <shot-id...>`). Shots record sequentially —
 * one live local stack, one browser at a time, film-real timing.
 */
import { captureShot } from "./lib/harness.mjs";
import { SHOTS } from "./shots.mjs";

const args = process.argv.slice(2);
const ids = args.length === 0 || args.includes("all") ? Object.keys(SHOTS).filter((s) => s !== "s4d-embed") : args;

for (const id of ids) {
  const drive = SHOTS[id];
  if (!drive) {
    console.error(`unknown shot '${id}' — known: ${Object.keys(SHOTS).join(", ")}`);
    process.exit(1);
  }
  await captureShot(id, drive);
}
