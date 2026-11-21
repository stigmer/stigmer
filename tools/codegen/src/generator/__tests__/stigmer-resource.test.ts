/**
 * Pins the reading of the Kubernetes operator's Stigmer definition
 * (stigmer-resource.ts) against the checkout's own generated definition: the
 * resource's names; the structural validation the docs gate applies (every
 * operator sample passes, and an unknown field, a value outside an enum, a
 * wrong type, a missing required field, a bound, a wrong apiVersion, another
 * kind and metadata that is not a mapping each fail with a sentence naming the
 * field); anchors into the spec; and the reference page, whose frontmatter
 * the docs site parses as text, which names every top-level field, carries
 * the generator marker, writes each rule as a sentence, collapses the
 * Kubernetes core types it does not own, and renders the same bytes twice.
 *
 * A small definition written for the test pins what the checkout's does not
 * exercise: a definition with no single stored version, or with no spec or
 * status, is refused with the file named; every schema shape the validator
 * knows (a null, an integer-or-string, a preserved free-form field, a list
 * and its entry cap, a string and its length and pattern, a number and its
 * bounds, an untyped field, a mapping) is judged with a sentence naming the
 * field; a printed column says its own description, or nothing for a field
 * outside the status; and writeStigmerReference writes the page it renders
 * into a directory it creates.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, parseAllDocuments, stringify } from "yaml";

import type { StigmerDefinition } from "../stigmer-resource.js";
import {
  loadStigmerDefinition,
  renderStigmerReference,
  resolveStigmerAnchor,
  validateStigmerFragment,
  validateStigmerManifest,
  writeStigmerReference,
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

  it("refuses a manifest of another kind outright, and metadata that is not a mapping", () => {
    expect(validateStigmerManifest({ ...minimal({ nonsense: true }), kind: "Agent" }, def)).toEqual([
      'a stigmer.ai/v1 manifest is a Stigmer, not "Agent"',
    ]);
    expect(validateStigmerManifest({ ...minimal({}), metadata: "stigmer" }, def)).toEqual([
      "Stigmer manifest: metadata must be a mapping with a name",
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

  it("shows an example address as code, never as a link", () => {
    expect(page).toContain("`http://minio.storage.svc:9000`");
    expect(page.replace(/`[^`]*`/g, "")).not.toMatch(/\bhttps?:\/\/(?!stigmer\.ai|kubernetes\.io)/);
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

/** A definition written for the test, in the shape controller-gen writes. */
function crd(versions: Record<string, unknown>[]): string {
  return stringify({
    apiVersion: "apiextensions.k8s.io/v1",
    kind: "CustomResourceDefinition",
    spec: { group: "example.test", scope: "Cluster", names: { kind: "Widget", plural: "widgets" }, versions },
  });
}

const WIDGET_SCHEMA = {
  openAPIV3Schema: {
    description: "A widget.",
    properties: {
      spec: {
        type: "object",
        properties: {
          size: { type: "number", minimum: 1, maximum: 10 },
          quantity: { "x-kubernetes-int-or-string": true },
          extra: { type: "object", "x-kubernetes-preserve-unknown-fields": true },
          tags: { type: "array", maxItems: 2, items: { type: "string" } },
          label: { type: "string", minLength: 3, maxLength: 5, pattern: "^[a-z]+$" },
          anything: { description: "Any value at all." },
        },
      },
      status: { type: "object", properties: { phase: { type: "string" } } },
    },
  },
};

const WIDGET_VERSION = {
  name: "v1",
  served: true,
  storage: true,
  additionalPrinterColumns: [
    { name: "Size", jsonPath: ".spec.size", description: "How big the widget is | in units {per pod} \\ per node" },
    { name: "Label", jsonPath: ".spec.label" },
  ],
  schema: WIDGET_SCHEMA,
};

describe("a definition written for the test", () => {
  let dir: string;
  let widgetPath: string;
  let widget: StigmerDefinition;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stigmer-resource-"));
    widgetPath = path.join(dir, "widget.yaml");
    fs.writeFileSync(widgetPath, crd([WIDGET_VERSION]));
    widget = loadStigmerDefinition(widgetPath);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is refused, naming the file, with no single stored version or with no spec or status", () => {
    const twoStored = path.join(dir, "two-stored.yaml");
    fs.writeFileSync(twoStored, crd([WIDGET_VERSION, { ...WIDGET_VERSION, name: "v2" }]));
    expect(() => loadStigmerDefinition(twoStored)).toThrow(`${twoStored}: expected one stored version, found 2`);

    const noneStored = path.join(dir, "none-stored.yaml");
    fs.writeFileSync(noneStored, crd([{ ...WIDGET_VERSION, storage: false }]));
    expect(() => loadStigmerDefinition(noneStored)).toThrow(`${noneStored}: expected one stored version, found 0`);

    const noStatus = path.join(dir, "no-status.yaml");
    fs.writeFileSync(
      noStatus,
      crd([{ ...WIDGET_VERSION, schema: { openAPIV3Schema: { properties: { spec: WIDGET_SCHEMA.openAPIV3Schema.properties.spec } } } }]),
    );
    expect(() => loadStigmerDefinition(noStatus)).toThrow(`${noStatus}: the schema has no spec or status`);
  });

  it("reads the stored version's names, schema and columns", () => {
    expect([widget.group, widget.version, widget.kind, widget.scope, widget.description]).toEqual([
      "example.test",
      "v1",
      "Widget",
      "Cluster",
      "A widget.",
    ]);
    expect(widget.shortNames).toEqual([]);
    expect(widget.columns.map((c) => c.name)).toEqual(["Size", "Label"]);
  });

  it("accepts every value each schema shape allows", () => {
    expect(
      validateStigmerFragment(
        { size: 2.5, quantity: "2Gi", extra: [1, "free-form"], tags: ["a", "b"], label: "abc", anything: { any: ["thing"] } },
        "Widget",
        widget,
      ),
    ).toEqual([]);
    expect(validateStigmerFragment({ size: 10, quantity: 3 }, "Widget", widget)).toEqual([]);
  });

  it("refuses a value of the wrong type for each shape, naming the field and the type it got", () => {
    expect(validateStigmerFragment("a widget", "Widget", widget)).toEqual(["spec: want a mapping, got string"]);
    expect(
      validateStigmerFragment({ size: "big", quantity: true, tags: "a", label: null }, "Widget", widget),
    ).toEqual([
      "spec.size: want a number, got string",
      "spec.quantity: want an integer or a string, got boolean",
      "spec.tags: want a list, got string",
      "spec.label: want a string, got null",
    ]);
    expect(validateStigmerFragment({ tags: [1] }, "Widget", widget)).toEqual(["spec.tags[0]: want a string, got integer"]);
  });

  it("refuses a value outside a bound, naming the bound", () => {
    expect(validateStigmerFragment({ size: 0.5 }, "Widget", widget)).toEqual(["spec.size: at least 1"]);
    expect(validateStigmerFragment({ size: 11 }, "Widget", widget)).toEqual(["spec.size: at most 10"]);
    expect(validateStigmerFragment({ tags: ["a", "b", "c"] }, "Widget", widget)).toEqual(["spec.tags: at most 2 entries, got 3"]);
    expect(validateStigmerFragment({ label: "ab" }, "Widget", widget)).toEqual(["spec.label: at least 3 characters"]);
    expect(validateStigmerFragment({ label: "abcdef" }, "Widget", widget)).toEqual(["spec.label: at most 5 characters"]);
    expect(validateStigmerFragment({ label: "ABC" }, "Widget", widget)).toEqual(['spec.label: "ABC" does not match ^[a-z]+$']);
  });

  it("prints a column's own description (a pipe, a brace and a backslash each escaped once), and nothing for a column outside the status that has none", () => {
    const page = renderStigmerReference(widget);
    expect(page).toContain("| Size | `.spec.size` | How big the widget is \\| in units \\{per pod\\} \\\\ per node |");
    expect(page).toContain("| Label | `.spec.label` |  |");
    expect(page).toContain("- **`anything`** (any): Any value at all.");
  });

  it("writes the page it renders into a directory it creates, and returns the file", () => {
    const out = path.join(dir, "pages", "reference");
    const file = writeStigmerReference(`${out}/`, widgetPath);
    expect(file).toBe(`${out}/stigmer.mdx`);
    expect(fs.readFileSync(file, "utf8")).toBe(renderStigmerReference(widget));
  });
});
