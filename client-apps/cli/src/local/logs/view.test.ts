import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { allComponents, componentByName, printTail } from "./view.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-logsview-"));
});

class CaptureSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(chunk);
  }
  get text(): string {
    return this.chunks.join("");
  }
}

describe("componentByName / allComponents", () => {
  it("knows the three daemon components", () => {
    expect(allComponents(dir).map((c) => c.name)).toEqual(["stigmer-server", "runner", "temporal"]);
    expect(componentByName(dir, "runner")?.file).toBe(join(dir, "runner.log"));
    expect(componentByName(dir, "bogus")).toBeUndefined();
  });
});

describe("printTail", () => {
  it("does not prefix a single component", () => {
    writeFileSync(join(dir, "runner.log"), "r1\nr2\n");
    const sink = new CaptureSink();
    printTail([componentByName(dir, "runner")!], 5, sink);
    expect(sink.text).toBe("r1\nr2\n");
  });

  it("prefixes lines with the component name when showing several", () => {
    writeFileSync(join(dir, "stigmer-server.log"), "s1\n");
    writeFileSync(join(dir, "runner.log"), "r1\n");
    writeFileSync(join(dir, "temporal.log"), "t1\n");
    const sink = new CaptureSink();
    printTail(allComponents(dir), 5, sink);
    expect(sink.text).toBe("[stigmer-server] s1\n[runner] r1\n[temporal] t1\n");
  });
});
