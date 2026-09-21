/**
 * Pins the coverage inventory's own rule for `is_skip_authorization` lanes
 * (docs/authorization-coverage.md, "How to read the tables"): a skip lane
 * reaches no Authorizer in either edition, so what guards it is whatever
 * its Handler cell names — and a cell that names nothing is a lane open to
 * every authenticated caller that nobody has said so about. Two things are
 * held here, so the doc cannot drift from the server it describes:
 *
 *   1. The set of skip-annotated methods the open-source server SERVES
 *      (the empty composition's routes replayed into a recorder, a method
 *      counted only when its service's implementation map carries it — a
 *      partially implemented service lists more on its descriptor than it
 *      serves) equals the set of skip rows in the doc, service by method.
 *      A new skip lane without a row, or a row for a lane that is no
 *      longer a skip, fails here.
 *   2. Every skip row's Handler cell carries one of the three markers the
 *      doc defines — `guard: <Name>`, `driver: <Seam>`,
 *      `by design: <reason>` — and every `guard:` names a pipeline step or
 *      a handler's guard function that exists by that name in `src/`
 *      outside the tests, so a renamed or removed guard cannot leave the
 *      doc pointing at nothing.
 *
 * The rule lives in the doc; this test only enforces it. The doc is the
 * one inventory (the package guide mandates updating it with every
 * annotation change), and a second list here would be the drift this
 * test exists to prevent.
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getOption } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { is_skip_authorization } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import {
  baseConfig,
  servedMethods,
  silentLogger,
} from "../../extensions/__tests__/composed-support.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../../..");
const COVERAGE_DOC = path.join(PACKAGE_ROOT, "docs/authorization-coverage.md");
const SRC = path.join(PACKAGE_ROOT, "src");

/** A skip row: `| Service.method | is_skip_authorization | <handler cell> |`. */
const SKIP_ROW =
  /^\| ([A-Za-z]+)\.([A-Za-z]+) \| is_skip_authorization \| (.*) \|$/;

const MARKERS = ["guard:", "driver:", "by design:"] as const;

interface SkipRow {
  readonly method: string;
  readonly handler: string;
}

function skipRowsOf(doc: string): SkipRow[] {
  const rows: SkipRow[] = [];
  for (const line of doc.split("\n")) {
    const m = SKIP_ROW.exec(line);
    if (m !== null) {
      rows.push({ method: `${m[1]}.${m[2]}`, handler: m[3] ?? "" });
    }
  }
  return rows;
}

/** Every `guard: <Name>` a handler cell names. */
function guardsOf(handler: string): string[] {
  return [...handler.matchAll(/guard: ([A-Za-z]+)/g)].map((m) => m[1] ?? "");
}

/** Every non-test `.ts` source under `src/`, read once. */
function sourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "__tests__") {
          walk(full);
        }
      } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
        parts.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(SRC);
  return parts.join("\n");
}

describe("the skip-lane inventory (docs/authorization-coverage.md) is true to the served server", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "skip-lane-inventory-test-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the doc's skip rows are exactly the skip-annotated methods the server serves", () => {
    const served = new Set<string>();
    for (const method of servedMethods(server.routes)) {
      if (getOption(method, is_skip_authorization)) {
        const serviceName = method.parent.typeName.split(".").at(-1) ?? "";
        served.add(`${serviceName}.${method.name}`);
      }
    }
    const documented = new Set(
      skipRowsOf(readFileSync(COVERAGE_DOC, "utf8")).map((r) => r.method),
    );
    expect([...served].sort()).toEqual([...documented].sort());
  });

  it("every skip row names its guard, its driver or says the lane is open by design", () => {
    const bare = skipRowsOf(readFileSync(COVERAGE_DOC, "utf8"))
      .filter((r) => !MARKERS.some((marker) => r.handler.includes(marker)))
      .map((r) => r.method);
    expect(bare).toEqual([]);
  });

  it("every guard a skip row names is a step or a guard function that exists by that name in src/", () => {
    const source = sourceText();
    const dangling: string[] = [];
    for (const row of skipRowsOf(readFileSync(COVERAGE_DOC, "utf8"))) {
      for (const guard of guardsOf(row.handler)) {
        // A step is registered by its quoted name; a guard function by its
        // declaration.
        const isStep = source.includes(`"${guard}"`);
        const isFunction = new RegExp(`function ${guard}\\(`).test(source);
        if (!isStep && !isFunction) {
          dangling.push(`${row.method} names guard ${guard}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});
