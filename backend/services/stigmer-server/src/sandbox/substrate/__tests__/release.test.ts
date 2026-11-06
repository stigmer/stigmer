/**
 * Pins the Substrate release the server names (release.ts) to the tag its
 * stubs are generated from (buf.gen.substrate.yaml): the skew sentence
 * (gateway.ts) must name the release the stubs actually speak.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SUBSTRATE_RELEASE } from "../release.js";

const BUF_TEMPLATE = fileURLToPath(
  new URL("../../../../buf.gen.substrate.yaml", import.meta.url),
);

describe("SUBSTRATE_RELEASE", () => {
  it("is the tag buf.gen.substrate.yaml generates the stubs from", () => {
    const refs = [
      ...readFileSync(BUF_TEMPLATE, "utf8").matchAll(/^\s*ref:\s*(\S+)\s*$/gm),
    ].map((match) => match[1]);
    expect(refs).toEqual([SUBSTRATE_RELEASE]);
  });
});
