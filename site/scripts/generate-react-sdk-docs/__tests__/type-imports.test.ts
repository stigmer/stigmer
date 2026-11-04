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

  it("reads a file TypeDoc gave relative to a package.json inside the pattern's folder (a library built for publishing)", () => {
    expect(patternSubpath(exportsMap, "ai/stigmer/agentic/run/v1/api_pb.d.ts")).toBe("ai/stigmer/agentic/run/v1/api_pb");
    expect(patternSubpath({ "./*": "./build/types/*.d.ts" }, "types/a_pb.d.ts")).toBe("a_pb");
    // A folder name is never split: `ist/` is not a folder of `dist/`.
    expect(patternSubpath({ "./*": "./dist*.d.ts" }, "x.d.ts")).toBeNull();
  });

  it("gives nothing for a file outside every pattern, or a map without one", () => {
    expect(patternSubpath(exportsMap, "src/index.ts")).toBeNull();
    expect(patternSubpath({ ".": "./dist/index.js" }, "dist/index.d.ts")).toBeNull();
    expect(patternSubpath(undefined, "dist/a.d.ts")).toBeNull();
  });

  it("gives nothing for a pattern whose target has no wildcard or no path, or a match that leaves the wildcard empty", () => {
    expect(patternSubpath({ "./*": "./dist/index.d.ts" }, "dist/index.d.ts")).toBeNull();
    expect(patternSubpath({ "./*": null }, "dist/a.d.ts")).toBeNull();
    expect(patternSubpath(exportsMap, "dist/.d.ts")).toBeNull();
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
    write("kit/package.json", JSON.stringify({ name: "@acme/kit", peerDependencies: { client: "*", protos: "*", typed: "*", single: "*", "@scope/pkg": "*" }, dependencies: { plain: "*" } }));
    // A scoped package typed by `@types/scope__pkg`.
    write("node_modules/@scope/pkg/package.json", JSON.stringify({ name: "@scope/pkg" }));
    write("node_modules/@types/scope__pkg/package.json", JSON.stringify({ name: "@types/scope__pkg", types: "index.d.ts" }));
    write("node_modules/@types/scope__pkg/index.d.ts", "export interface Scoped {}\n");
    // A peer whose `exports` is one path: its root is that file.
    write("node_modules/single/package.json", JSON.stringify({ name: "single", exports: "./index.js", types: "index.d.ts" }));
    write("node_modules/single/index.d.ts", "export interface Single {}\n");
    write("node_modules/client/package.json", JSON.stringify({ name: "client", types: "index.d.ts" }));
    // The client also has a `Node`: the declaring package's peer wins over the first peer that has the name.
    // It also has a `Plain` of its own: never the plain dependency's `Plain`.
    write("node_modules/client/index.d.ts", 'export interface Client {}\nexport type Node = number;\nexport interface Plain { mine: true }\nexport type { ToolUse } from "log";\n');
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

  it("imports a type from a peer whose exports map is one path", () => {
    expect(createTypeImportResolver(kitDir)("Single", t("single"))).toBe("single");
  });

  it("refuses a kit whose peer is not installed", () => {
    write("lonely/package.json", JSON.stringify({ name: "@acme/lonely", peerDependencies: { absent: "*" } }));
    expect(() => createTypeImportResolver(path.join(root, "lonely"))).toThrow(/cannot find the package absent/);
  });

  it("imports an @types package's type from the package it types, ahead of another peer with the name", () => {
    expect(createTypeImportResolver(kitDir)("Node", t("@types/typed"))).toBe("typed");
  });

  it("imports a scoped @types package's type from the scoped package", () => {
    expect(createTypeImportResolver(kitDir)("Scoped", t("@types/scope__pkg"))).toBe("@scope/pkg");
  });

  it("gives the kit's own types, the language's globals and a plain dependency's types no import, even when a peer has a type of that name", () => {
    const resolve = createTypeImportResolver(kitDir);
    expect(resolve("Offered", t("@acme/kit", "src/offered.ts"))).toBeNull();
    expect(resolve("Promise", t("typescript", "lib/lib.es5.d.ts"))).toBeNull();
    expect(resolve("Plain", t("plain"))).toBeNull();
  });
});
