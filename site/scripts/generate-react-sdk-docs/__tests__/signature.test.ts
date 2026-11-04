/**
 * Tests for the kit reference's signature line: `signatureOf` reads a
 * TypeDoc call signature and `renderSignature` writes a declaration that
 * compiles. Type parameters keep their constraint and default; a parameter
 * with a default value is optional, written `name?: T`, unless a required
 * parameter follows it, where it is `name: T | undefined` (a function type
 * in parentheses); the types it names that a reader imports from a package
 * they install sit above the fence's `---cut---` line, one line per module,
 * and a type the resolver gives no module (the kit's own, or a plain
 * dependency's) gets no line. A type inside `readonly T[]` is found, and
 * two types of one name from two modules are refused.
 */

import { describe, expect, it } from "vitest";
import { renderSignature, signatureOf, type TypeImportResolver } from "../mdx-utils";
import { ReflectionKind } from "../typedoc-types";
import type { ExternalTarget, Reflection, TypeDocType } from "../typedoc-types";

function target(packageName: string, packagePath = "index.d.ts"): ExternalTarget {
  return { packageName, packagePath, qualifiedName: "x" };
}

function ref(name: string, packageName: string, packagePath?: string): TypeDocType {
  return { type: "reference", name, target: target(packageName, packagePath), package: packageName };
}

const STRING: TypeDocType = { type: "intrinsic", name: "string" };

function param(name: string, type: TypeDocType, extra: Partial<Reflection> = {}): Reflection {
  return { id: 0, name, variant: "param", kind: ReflectionKind.Parameter, flags: {}, type, ...extra };
}

function sig(parameters: Reflection[], type: TypeDocType = { type: "intrinsic", name: "void" }, extra: Partial<Reflection> = {}): Reflection {
  return { id: 0, name: "f", variant: "signature", kind: ReflectionKind.CallSignature, flags: {}, parameters, type, ...extra };
}

/** Peers are imported from where the test says; everything else gets no line. */
const RESOLVE: TypeImportResolver = (_name, t) =>
  t.packageName === "@stigmer/apis" ? `@stigmer/apis/${t.packagePath.replace(/^dist\//, "").replace(/\.d\.ts$/, "")}` : t.packageName === "@stigmer/client" ? "@stigmer/client" : null;

const render = (s: Reflection, name = "useThing") => renderSignature(signatureOf(name, s, RESOLVE));

describe("signatureOf and renderSignature", () => {
  it("writes the declaration alone when it names no type to import", () => {
    expect(render(sig([param("org", STRING)], STRING))).toBe("```tsx\nfunction useThing(org: string): string\n```\n\n");
  });

  it("keeps type parameters with their constraint and default", () => {
    const typeParameters: Reflection[] = [
      { id: 1, name: "TData", variant: "typeParam", kind: 131072, flags: {} },
      { id: 2, name: "T", variant: "typeParam", kind: 131072, flags: {}, type: { type: "reference", name: "Base", target: 9 }, default: { type: "reference", name: "Base", target: 9 } },
    ];
    const tdata: TypeDocType = { type: "reference", name: "TData", target: -1 };
    expect(render(sig([param("rows", { type: "array", elementType: tdata })], tdata, { typeParameters }), "useList")).toBe(
      "```tsx\nfunction useList<TData, T extends Base = Base>(rows: TData[]): TData\n```\n\n",
    );
  });

  it("makes a parameter with a default value optional", () => {
    const s = sig([param("org", STRING), param("limit", { type: "intrinsic", name: "number" }, { defaultValue: "25" })]);
    expect(signatureOf("useThing", s, RESOLVE).parameters.map((p) => p.optional)).toEqual([false, true]);
    expect(render(s)).toContain("function useThing(org: string, limit?: number): void");
  });

  it("writes an optional parameter before a required one as `T | undefined`, a function type in parentheses", () => {
    const callback: TypeDocType = { type: "reflection", declaration: { id: 3, name: "__type", variant: "declaration", kind: 65536, flags: {}, signatures: [sig([], { type: "intrinsic", name: "void" })] } };
    const s = sig([
      param("keys", STRING, { flags: { isOptional: true } }),
      param("onDone", callback, { defaultValue: "noop" }),
      param("mode", STRING),
      param("tail", STRING, { flags: { isOptional: true } }),
    ]);
    expect(render(s)).toContain("function useThing(keys: string | undefined, onDone: (() => void) | undefined, mode: string, tail?: string): void");
  });

  it("names a destructured parameter `options`, and drops `this`", () => {
    const options: TypeDocType = { type: "reflection", declaration: { id: 4, name: "__type", variant: "declaration", kind: 65536, flags: {}, children: [param("org", STRING, { kind: ReflectionKind.Property })] } };
    expect(render(sig([param("this", STRING), param("__namedParameters", options)]))).toContain("function useThing(options: { org: string }): void");
  });

  it("imports a peer's types above the cut, one line per module, the path's extension dropped", () => {
    const run = ref("Run", "@stigmer/apis", "dist/ai/stigmer/agentic/run/v1/api_pb.d.ts");
    const runSpec = ref("RunSpec", "@stigmer/apis", "dist/ai/stigmer/agentic/run/v1/api_pb.d.ts");
    const s = sig([param("run", run), param("spec", runSpec), param("ref", ref("ResourceRef", "@stigmer/client"))], run);
    expect(render(s)).toBe(
      "```tsx\n" +
        'import type { Run, RunSpec } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";\n' +
        'import type { ResourceRef } from "@stigmer/client";\n' +
        "// ---cut---\n" +
        "function useThing(run: Run, spec: RunSpec, ref: ResourceRef): Run\n" +
        "```\n\n",
    );
  });

  it("gives a type of the kit's own, or of a plain dependency, no import line", () => {
    const s = sig([param("a", ref("OfferedFeature", "@stigmer/react-sdk")), param("b", ref("ToolCategoryInfo", "@stigmer/react-core"))]);
    expect(signatureOf("useThing", s, RESOLVE).imports).toEqual([]);
    expect(render(s)).not.toContain("---cut---");
  });

  it("finds a type inside `readonly T[]`, and keeps `readonly (keyof T)[]` parenthesised", () => {
    const readonlyRuns: TypeDocType = { type: "typeOperator", operator: "readonly", target: { type: "array", elementType: ref("Run", "@stigmer/apis", "dist/run_pb.d.ts") } };
    const keys: TypeDocType = { type: "typeOperator", operator: "readonly", target: { type: "array", elementType: { type: "typeOperator", operator: "keyof", target: { type: "reference", name: "Draft", target: 7 } } } };
    const out = render(sig([param("runs", readonlyRuns), param("fields", keys)]));
    expect(out).toContain('import type { Run } from "@stigmer/apis/run_pb";');
    expect(out).toContain("function useThing(runs: readonly Run[], fields: readonly (keyof Draft)[]): void");
  });

  it("refuses two types of one name from two modules", () => {
    const s = sig([param("a", ref("Session", "@stigmer/apis", "dist/session_pb.d.ts")), param("b", ref("Session", "@stigmer/client"))]);
    expect(() => signatureOf("useThing", s, RESOLVE)).toThrow(/useThing names two types called Session/);
  });
});
