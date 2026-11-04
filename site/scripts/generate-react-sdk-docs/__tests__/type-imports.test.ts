/**
 * Tests for where the kit reference imports a signature's types from
 * (`type-imports.ts`), over a kit written to a temporary folder with its own
 * `node_modules`: a peer whose `exports` map has a pattern is imported from
 * the subpath its declaring file matches, the extension dropped; a type
 * declared in a package the reader never installs is imported from the peer
 * whose root re-exports it; an `@types/` package's type from the package it
 * types; and the kit's own types, the language's globals and a plain
 * dependency's types get no import.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTypeImportResolver, patternSubpath } from "../type-imports";
import type { ExternalTarget } from "../typedoc-types";

describe("patternSubpath", () => {
  const exportsMap = { "./*": { types: "./dist/*.d.ts", import: "./dist/*.js" } };

  it("gives the subpath a declaring file matches, the extension dropped", () => {
    expect(patternSubpath(exportsMap, "dist/ai/stigmer/agentic/run/v1/api_pb.d.ts")).toBe("ai/stigmer/agentic/run/v1/api_pb");
    expect(patternSubpath({ "./gen/*": "./out/*.d.ts" }, "out/a/b.d.ts")).toBe("gen/a/b");
  });

  it("gives nothing for a file outside every pattern, or a map without one", () => {
    expect(patternSubpath(exportsMap, "src/index.ts")).toBeNull();
    expect(patternSubpath({ ".": "./dist/index.js" }, "dist/index.d.ts")).toBeNull();
    expect(patternSubpath(undefined, "dist/a.d.ts")).toBeNull();
  });
});

describe("createTypeImportResolver", () => {
  let kitDir: string;
  let root: string;

  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const t = (packageName: string, packagePath = "index.d.ts"): ExternalTarget => ({ packageName, packagePath, qualifiedName: "x" });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "react-sdk-docs-imports-"));
    kitDir = path.join(root, "kit");
    write("kit/package.json", JSON.stringify({ name: "@acme/kit", peerDependencies: { client: "*", protos: "*", typed: "*" }, dependencies: { plain: "*" } }));
    write("node_modules/client/package.json", JSON.stringify({ name: "client", types: "index.d.ts" }));
    // The client also has a `Node`: the declaring package's peer wins over the first peer that has the name.
    write("node_modules/client/index.d.ts", 'export interface Client {}\nexport type Node = number;\nexport type { ToolUse } from "log";\n');
    write("node_modules/log/package.json", JSON.stringify({ name: "log", types: "index.d.ts" }));
    write("node_modules/log/index.d.ts", "export interface ToolUse {}\n");
    write("node_modules/protos/package.json", JSON.stringify({ name: "protos", exports: { "./*": { types: "./dist/*.d.ts" } } }));
    write("node_modules/typed/package.json", JSON.stringify({ name: "typed" }));
    write("node_modules/@types/typed/package.json", JSON.stringify({ name: "@types/typed", types: "index.d.ts" }));
    write("node_modules/@types/typed/index.d.ts", "export type Node = string;\n");
    write("node_modules/plain/package.json", JSON.stringify({ name: "plain", types: "index.d.ts" }));
    write("node_modules/plain/index.d.ts", "export interface Plain {}\n");
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("imports a patterned peer's type from the subpath its file matches", () => {
    expect(createTypeImportResolver(kitDir)("Run", t("protos", "dist/run/v1/api_pb.d.ts"))).toBe("protos/run/v1/api_pb");
  });

  it("imports a peer's type from its root, and a re-exported type from the peer that re-exports it", () => {
    const resolve = createTypeImportResolver(kitDir);
    expect(resolve("Client", t("client"))).toBe("client");
    expect(resolve("ToolUse", t("log", "index.d.ts"))).toBe("client");
  });

  it("imports an @types package's type from the package it types, ahead of another peer with the name", () => {
    expect(createTypeImportResolver(kitDir)("Node", t("@types/typed"))).toBe("typed");
  });

  it("gives the kit's own types, the language's globals and a plain dependency's types no import", () => {
    const resolve = createTypeImportResolver(kitDir);
    expect(resolve("Offered", t("@acme/kit", "src/offered.ts"))).toBeNull();
    expect(resolve("Promise", t("typescript", "lib/lib.es5.d.ts"))).toBeNull();
    expect(resolve("Plain", t("plain"))).toBeNull();
  });
});
