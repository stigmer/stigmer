/**
 * Pins the Node floor `@stigmer/outbound/dial` checks at load: Node 22 from
 * 22.19, 23 from 23.8, every later major; below it the refusal names the
 * floor and the running version. The 22.x floor is held to the installed
 * undici's declared `engines` lower bound, so an undici bump that raises
 * its floor fails here until the check moves with it. And the check is the
 * entry's first import, so it runs before undici loads.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { DIAL_NODE_FLOOR, dialRuntimeRefusal } from "../dial/runtime-floor.js";

describe("the /dial runtime floor", () => {
  it.each(["22.19.0", "22.22.1", "23.8.0", "23.11.1", "24.0.0", "26.1.0"])("lets %s load the entry", (version) => {
    expect(dialRuntimeRefusal(version)).toBeUndefined();
  });

  it.each(["22.13.0", "22.18.9", "23.4.0", "23.7.0", "20.19.0", "21.7.3", "not-a-version"])(
    "refuses %s, naming the floor and the running version",
    (version) => {
      expect(dialRuntimeRefusal(version)).toBe(
        `@stigmer/outbound/dial needs Node 22.19 or newer on 22.x, or 23.8 or newer; this is ${version}.`,
      );
    },
  );

  it("holds the 22.x floor to the installed undici's declared engines", () => {
    const undiciPkg = createRequire(import.meta.url).resolve("undici/package.json");
    const engines = (JSON.parse(readFileSync(undiciPkg, "utf8")) as { engines?: { node?: string } }).engines?.node;
    const floor = /^>=(\d+)\.(\d+)\.\d+$/.exec(engines ?? "");
    expect(floor, `undici declares engines.node ${String(engines)}`).not.toBeNull();
    expect({ major: Number(floor?.[1]), minor: Number(floor?.[2]) }).toEqual(DIAL_NODE_FLOOR.line22);
  });

  it("runs before undici loads: the entry imports it first", () => {
    const entry = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "dial", "index.ts"), "utf8");
    const requests = ts.preProcessFile(entry, true, true).importedFiles.map((f) => f.fileName);
    expect(requests[0]).toBe("./runtime-floor.js");
  });
});
