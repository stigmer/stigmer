/**
 * Holds `reviewSchemaChain` (../schema-review.ts) to the store README's
 * rules 2 and 3: each statement that drops, renames, retypes or tightens
 * what exists is refused without a `contract` and passes with one; what
 * only looks like such a statement (a loosening, a quoted word, a new
 * table) passes bare; a stale or blank contract is refused; and a chain
 * module that reaches generated code, directly, through a helper or
 * through an import the review cannot resolve, is refused, while an
 * `import type` passes. Chain modules are fixtures in a temporary folder.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { reviewSchemaChain } from "../schema-review.js";

const dir = mkdtempSync(path.join(tmpdir(), "schema-review-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a fixture module and returns its path. */
function module(name: string, source: string): string {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

const CHAIN = module("chain.ts", `export const STEPS = [];\n`);

function review(statement: string, contract?: string): string[] {
  return reviewSchemaChain(CHAIN, [
    { version: 1, statements: [`CREATE TABLE t (id TEXT PRIMARY KEY)`] },
    { version: 2, statements: [statement], contract },
  ]);
}

describe("reviewSchemaChain, rule 2", () => {
  it.each([
    ["ALTER TABLE t DROP COLUMN org", "drops what exists"],
    ["ALTER TABLE t DROP org", "drops what exists"],
    ["DROP TABLE t", "drops what exists"],
    ["DROP INDEX t_org", "drops what exists"],
    ["ALTER TABLE t ALTER COLUMN org DROP DEFAULT", "drops what exists"],
    ["ALTER TABLE t RENAME COLUMN org TO organization", "renames what exists"],
    ["ALTER TABLE t ALTER COLUMN org TYPE BIGINT", "changes a column's type"],
    ["ALTER TABLE t ALTER org SET DATA TYPE BIGINT", "changes a column's type"],
    [
      "ALTER TABLE t ALTER COLUMN org SET NOT NULL",
      "makes an existing column required",
    ],
    [
      "ALTER TABLE t ADD COLUMN org TEXT NOT NULL",
      "adds a required column with no default",
    ],
    [
      "ALTER TABLE t ADD COLUMN a TEXT NOT NULL DEFAULT '', ADD COLUMN b TEXT NOT NULL",
      "adds a required column with no default",
    ],
    [
      "ALTER TABLE t ADD CONSTRAINT t_org_check CHECK (org <> '')",
      "adds a constraint to an existing table",
    ],
    [
      "ALTER TABLE t ADD UNIQUE (org)",
      "adds a constraint to an existing table",
    ],
    [
      "ALTER TABLE t ADD FOREIGN KEY (org) REFERENCES o (id)",
      "adds a constraint to an existing table",
    ],
  ])("refuses %s without a contract, naming the step and the rule", (statement, risk) => {
    expect(review(statement)).toEqual([
      `${CHAIN}: v2 statement 1 ${risk}; give the step a \`contract\` saying why the previous release no longer reads or writes what it changes (store README, "Schema migrations", rule 2)`,
    ]);
    expect(review(statement, "the previous release neither reads nor writes it")).toEqual([]);
  });

  it.each([
    "ALTER TABLE t ALTER COLUMN org DROP NOT NULL",
    "ALTER TABLE t ADD COLUMN note TEXT DEFAULT 'drop it' -- rename later",
    `ALTER TABLE t ADD COLUMN "drop" TEXT /* not a DROP */`,
    "CREATE TABLE u (id TEXT NOT NULL, CONSTRAINT u_id_check CHECK (id <> ''))",
    "ALTER TABLE t ADD COLUMN org TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE t ADD COLUMN created NUMERIC(10, 2)",
    "CREATE INDEX t_org ON t (org)",
  ])("passes %s without a contract", (statement) => {
    expect(review(statement)).toEqual([]);
  });

  it("reads a doubled quote as part of its literal, and an unterminated span to the end", () => {
    expect(review("ALTER TABLE t ADD COLUMN note TEXT DEFAULT 'it''s a DROP'")).toEqual([]);
    expect(review("ALTER TABLE t ADD COLUMN note TEXT DEFAULT 'DROP")).toEqual([]);
    expect(review("ALTER TABLE t ADD COLUMN note TEXT /* DROP")).toEqual([]);
  });

  it("reads a statement of many unclosed comment openers in one pass", () => {
    const started = performance.now();
    expect(review(`/*${"a/*".repeat(200_000)}`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("still sees a DROP inside a dollar-quoted body", () => {
    expect(review("DO $$ BEGIN DROP TABLE t; END $$")).toEqual([
      expect.stringContaining("v2 statement 1 drops what exists"),
    ]);
  });

  it("refuses a contract on a step that changes nothing that exists", () => {
    expect(review("CREATE INDEX t_org ON t (org)", "nothing reads it")).toEqual([
      `${CHAIN}: v2 has a contract, but no statement drops, renames, retypes or tightens what exists; remove the stale reason`,
    ]);
  });

  it("refuses a blank contract", () => {
    expect(review("DROP TABLE t", "  ")).toEqual([
      expect.stringContaining(`${CHAIN}: v2 has a blank contract`),
    ]);
  });
});

describe("reviewSchemaChain, rule 3", () => {
  const STEPS = [{ version: 1, statements: [`CREATE TABLE t (id TEXT)`] }];

  it("refuses a chain module that imports generated code", () => {
    const chain = module(
      "direct/chain.ts",
      `import { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";\n`,
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([
      `${chain}: imports "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb"; a schema step decodes only through descriptors frozen in the step, never live generated code (store README, "Schema migrations", rule 3)`,
    ]);
  });

  it("refuses generated code reached through a relative helper", () => {
    module("helper/decode.ts", `export { fromBinary } from "./gen/thing_pb.js";\n`);
    module("helper/gen/thing_pb.ts", `export const fromBinary = 1;\n`);
    const chain = module(
      "helper/chain.ts",
      `import { fromBinary } from "./decode.js";\n`,
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([
      expect.stringContaining(
        `${chain}, through decode.ts: imports "./gen/thing_pb.js"`,
      ),
    ]);
  });

  it("reads an import wrapped over several lines", () => {
    const chain = module(
      "wrapped/chain.ts",
      `import {\n  Agent,\n  AgentSpec,\n} from "@stigmer/apis/agent_pb";\n`,
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([
      expect.stringContaining(`imports "@stigmer/apis/agent_pb"`),
    ]);
  });

  it("reads an import after a lone quote on an earlier line", () => {
    const chain = module(
      "lone-quote/chain.ts",
      `const quote = /'/;\nimport { Agent } from "@stigmer/apis/agent_pb";\n`,
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([
      expect.stringContaining(`imports "@stigmer/apis/agent_pb"`),
    ]);
  });

  it("refuses a dynamic import of generated code", () => {
    const chain = module(
      "dynamic/chain.ts",
      `export const load = () => import("@stigmer/apis");\n`,
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([
      expect.stringContaining(`imports "@stigmer/apis"`),
    ]);
  });

  it("refuses a relative import it cannot resolve", () => {
    const chain = module("missing/chain.ts", `import { x } from "./gone.js";\n`);
    expect(reviewSchemaChain(chain, STEPS)).toEqual([
      `${chain}: cannot resolve "./gone.js"; every module a chain reaches is read for generated code`,
    ]);
  });

  it("passes an import type and a mention in a comment", () => {
    const chain = module(
      "typed/chain.ts",
      [
        `// import { Agent } from "@stigmer/apis/agent_pb";`,
        `import type { Agent } from "@stigmer/apis/agent_pb";`,
        `export type { AgentSpec } from "@stigmer/apis/agent_pb";`,
        `import type { PoolClient } from "pg";`,
        `import { runSchemaChain } from "@stigmer/server";`,
        "",
      ].join("\n"),
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([]);
  });

  it("reads no import inside a string, an escaped quote or an unclosed one", () => {
    const chain = module(
      "strings/chain.ts",
      [
        String.raw`const a = "import { x } from \"@stigmer/apis\"";`,
        String.raw`const b = 'it\'s import("@stigmer/apis")';`,
        String.raw`const c = /'/;`,
        'export const SQL = `-- an export from "./gone.js"`;',
        "export default 1",
      ].join("\n"),
    );
    expect(reviewSchemaChain(chain, STEPS)).toEqual([]);
  });

  it("reads a module of many unclosed comment openers in one pass", () => {
    const chain = module("openers/chain.ts", `/*${"a/*".repeat(200_000)}`);
    const started = performance.now();
    expect(reviewSchemaChain(chain, STEPS)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("counts inline type specifiers as a value import", () => {
    const chain = module(
      "inline/chain.ts",
      `import { type Agent, AgentSpec } from "@stigmer/apis/agent_pb";\n`,
    );
    expect(reviewSchemaChain(chain, STEPS)).toHaveLength(1);
  });
});
