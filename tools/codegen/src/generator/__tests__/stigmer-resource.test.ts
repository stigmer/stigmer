/**
 * Pins the reading of the Kubernetes operator's Stigmer definition
 * (stigmer-resource.ts) against the checkout's own generated definition: the
 * resource's names; the structural validation the docs gate applies (every
 * operator sample passes, and an unknown field, a value outside an enum, a
 * wrong type, a missing required field, a bound and a wrong apiVersion each
 * fail with a sentence naming the field); anchors into the spec; and the
 * reference page, whose frontmatter the docs site parses as text, which names
 * every top-level field, carries the generator marker, writes each rule as a sentence, collapses the Kubernetes core types
 * it does not own, and renders the same bytes twice.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";

import {
  loadStigmerDefinition,
  renderStigmerReference,
  resolveStigmerAnchor,
  validateStigmerFragment,
  validateStigmerManifest,
} from "../stigmer-resource.js";

const def = loadStigmerDefinition();
const SAMPLES = fileURLToPath(new URL("../../../../../deploy/operator/config/samples/", import.meta.url));

const minimal = (spec: Record<string, unknown>): Record<string, unknown> => ({
  apiVersion: "stigmer.ai/v1",
  kind: "Stigmer",
  metadata: { name: "stigmer", namespace: "stigmer" },
  spec,
});

describe("the Stigmer definition", () => {
  it("names the resource the operator serves", () => {
    expect([def.group, def.version, def.kind, def.scope]).toEqual(["stigmer.ai", "v1", "Stigmer", "Namespaced"]);
    expect(def.shortNames).toContain("stg");
    expect(Object.keys(def.spec.properties ?? {})).toEqual(expect.arrayContaining(["owner", "runner", "ingress", "sandboxes"]));
    expect(def.columns.map((c) => c.name)).toContain("Phase");
  });

  it("accepts every operator sample", () => {
    const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const doc of parseAllDocuments(fs.readFileSync(path.join(SAMPLES, file), "utf8"))) {
        expect(validateStigmerManifest(doc.toJS() as Record<string, unknown>, def), file).toEqual([]);
      }
    }
  });

  it("refuses an unknown field, a value outside an enum, a wrong type, a missing required field and a bound, naming each", () => {
    expect(validateStigmerManifest(minimal({ ingres: { hostname: "x" } }), def)).toEqual([
      expect.stringContaining('spec: unknown field "ingres" (did you mean "ingress"?)'),
    ]);
    expect(validateStigmerManifest(minimal({ image: { pullPolicy: "Sometimes" } }), def)).toEqual([
      'spec.image.pullPolicy: "Sometimes" is not one of "Always", "IfNotPresent", "Never"',
    ]);
    expect(validateStigmerManifest(minimal({ database: { postgresql: { external: { host: "db", user: "u", passwordSecret: { name: "s", key: "k" }, port: "5432" } } } }), def)).toEqual([
      "spec.database.postgresql.external.port: want an integer, got string",
    ]);
    expect(validateStigmerManifest(minimal({ ingress: { tls: { secretName: "t" } } }), def)).toEqual(["spec.ingress.hostname is required"]);
    expect(validateStigmerManifest(minimal({ database: { postgresql: { external: { host: "db", user: "u", passwordSecret: { name: "s", key: "k" }, port: 70000 } } } }), def)).toEqual([
      "spec.database.postgresql.external.port: at most 65535",
    ]);
  });

  it("refuses a manifest of another version, with no name, or with fields an example does not set", () => {
    const wrong = { ...minimal({}), apiVersion: "stigmer.ai/v2", status: {} };
    expect(validateStigmerManifest(wrong, def)).toEqual([
      'Stigmer manifest: apiVersion is "stigmer.ai/v2", want "stigmer.ai/v1"',
      'Stigmer manifest: unknown top-level field "status" (a docs example declares apiVersion, kind, metadata and spec)',
    ]);
    expect(validateStigmerManifest({ ...minimal({}), metadata: { namespace: "stigmer", uid: "x" } }, def)).toEqual([
      "Stigmer manifest: metadata.name is required",
      "Stigmer manifest: metadata.uid is not a field an example sets",
    ]);
  });

  it("resolves an anchor to the spec or a field under it, and names a path it does not have", () => {
    expect(resolveStigmerAnchor("Stigmer", def).path).toBe("spec");
    expect(resolveStigmerAnchor("Stigmer.database.postgresql", def).path).toBe("spec.database.postgresql");
    expect(validateStigmerFragment({ hostname: "stigmer.example.com", tls: { secretName: "t" } }, "Stigmer.ingress", def)).toEqual([]);
    expect(() => resolveStigmerAnchor("Stigmer.owner.email", def)).toThrow('validate-as "Stigmer.owner.email": spec.owner has no object field "email"');
    expect(() => resolveStigmerAnchor("Agent.spec", def)).toThrow('validate-as "Agent.spec" does not name the Stigmer resource');
  });
});

describe("the reference page", () => {
  const page = renderStigmerReference(def);

  it("carries frontmatter the docs site parses, the generator marker and a section for every top-level field", () => {
    const frontmatter = parse(/^---\n([\s\S]*?)\n---/.exec(page)?.[1] ?? "") as Record<string, unknown>;
    expect(typeof frontmatter.title).toBe("string");
    expect(typeof frontmatter.description).toBe("string");
    expect(page).toContain("{/* Auto-generated by gen-operator-docs");
    for (const field of Object.keys(def.spec.properties ?? {})) {
      expect(page, field).toContain(`- **\`${field}\`**`);
    }
    expect(page).toContain("## What `kubectl get stigmer` prints");
  });

  it("writes every rule as a sentence and collapses the Kubernetes types it does not own", () => {
    const rules = page.split("\n").filter((line) => line.includes("Rule: "));
    expect(rules.length).toBeGreaterThan(0);
    expect(page).not.toMatch(/Rule: [^\n]*[a-z]$/m);
    expect(page).not.toContain("`spec.server.extraEnv[].valueFrom`");
    expect(page).not.toContain("**`claims`**");
    expect(page).toContain("Kubernetes [environment variables]");
  });

  it("escapes MDX expressions outside inline code, and renders the same bytes twice", () => {
    const outsideCode = page
      .split("\n")
      .filter((line) => !line.startsWith("{/*"))
      .join("\n")
      .replace(/`[^`]*`/g, "");
    expect(outsideCode).not.toMatch(/(^|[^\\])\{/);
    expect(renderStigmerReference(def)).toBe(page);
  });
});
