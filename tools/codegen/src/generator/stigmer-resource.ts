// The Stigmer resource, read from the Kubernetes operator's generated
// definition (deploy/operator/config/crd/bases/stigmer.ai_stigmers.yaml,
// which controller-gen writes from the Go types in deploy/operator/api/v1).
// The definition is the one description of the resource, so two docs tools
// read it rather than a copy:
//
//   - the docs YAML gate validates every `apiVersion: stigmer.ai/v1` fence
//     against its schema (validateStigmerManifest, validateStigmerFragment):
//     unknown fields, types, enums, bounds and required fields. Cross-field
//     CEL rules are not evaluated here; the operator's samples envtest runs
//     them on a real API server;
//   - gen-operator-docs renders the reference page from it
//     (renderStigmerReference): every field with its type, default, allowed
//     values, bounds, rules and the description written on the Go type.
//
// Two Kubernetes core types are rendered as one line each rather than walked
// (resource requirements and environment variables), since their fields are
// Kubernetes' to document; they are recognised by shape.

import * as fs from "node:fs";

import { parse } from "yaml";

/** The definition this checkout's operator generates. */
export const STIGMER_DEFINITION_PATH = new URL(
  "../../../../deploy/operator/config/crd/bases/stigmer.ai_stigmers.yaml",
  import.meta.url,
);

/** The repository path the reference page names as its source. */
const DEFINITION_REPO_PATH = "deploy/operator/config/crd/bases/stigmer.ai_stigmers.yaml";

export interface SchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  additionalProperties?: SchemaNode | boolean;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  anyOf?: SchemaNode[];
  "x-kubernetes-int-or-string"?: boolean;
  "x-kubernetes-preserve-unknown-fields"?: boolean;
  "x-kubernetes-validations"?: { rule: string; message?: string }[];
}

export interface PrinterColumn {
  name: string;
  jsonPath: string;
  description?: string;
}

export interface StigmerDefinition {
  group: string;
  version: string;
  kind: string;
  plural: string;
  shortNames: string[];
  scope: string;
  description: string;
  spec: SchemaNode;
  status: SchemaNode;
  columns: PrinterColumn[];
}

interface RawDefinition {
  spec: {
    group: string;
    scope: string;
    names: { kind: string; plural: string; shortNames?: string[] };
    versions: {
      name: string;
      served: boolean;
      storage: boolean;
      additionalPrinterColumns?: PrinterColumn[];
      schema: { openAPIV3Schema: SchemaNode };
    }[];
  };
}

/** Reads the definition; it names one stored version, the one the docs describe. */
export function loadStigmerDefinition(path: string | URL = STIGMER_DEFINITION_PATH): StigmerDefinition {
  const raw = parse(fs.readFileSync(path, "utf8")) as RawDefinition;
  const stored = raw.spec.versions.filter((v) => v.storage);
  if (stored.length !== 1) {
    throw new Error(`${String(path)}: expected one stored version, found ${stored.length}`);
  }
  const v = stored[0];
  const root = v.schema.openAPIV3Schema;
  const spec = root.properties?.spec;
  const status = root.properties?.status;
  if (spec === undefined || status === undefined) {
    throw new Error(`${String(path)}: the schema has no spec or status`);
  }
  return {
    group: raw.spec.group,
    version: v.name,
    kind: raw.spec.names.kind,
    plural: raw.spec.names.plural,
    shortNames: raw.spec.names.shortNames ?? [],
    scope: raw.spec.scope,
    description: root.description ?? "",
    spec,
    status,
    columns: v.additionalPrinterColumns ?? [],
  };
}

// ============================================================================
// Validation
// ============================================================================

const METADATA_FIELDS = new Set(["name", "namespace", "labels", "annotations"]);

/** The problems with a whole manifest of the resource: apiVersion, kind, metadata, spec. */
export function validateStigmerManifest(doc: Record<string, unknown>, def: StigmerDefinition): string[] {
  const problems: string[] = [];
  const want = `${def.group}/${def.version}`;
  if (doc.apiVersion !== want) problems.push(`${def.kind} manifest: apiVersion is "${String(doc.apiVersion)}", want "${want}"`);
  if (doc.kind !== def.kind) {
    problems.push(`a ${want} manifest is a ${def.kind}, not "${String(doc.kind)}"`);
    return problems;
  }
  for (const key of Object.keys(doc)) {
    if (!["apiVersion", "kind", "metadata", "spec"].includes(key)) {
      problems.push(`${def.kind} manifest: unknown top-level field "${key}" (a docs example declares apiVersion, kind, metadata and spec)`);
    }
  }
  const metadata = doc.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    problems.push(`${def.kind} manifest: metadata must be a mapping with a name`);
  } else {
    const m = metadata as Record<string, unknown>;
    if (typeof m.name !== "string" || m.name === "") problems.push(`${def.kind} manifest: metadata.name is required`);
    for (const key of Object.keys(m)) {
      if (!METADATA_FIELDS.has(key)) problems.push(`${def.kind} manifest: metadata.${key} is not a field an example sets`);
    }
  }
  if (doc.spec !== undefined) problems.push(...validateNode(doc.spec, def.spec, "spec"));
  return problems;
}

/**
 * The schema node an anchor names: `Stigmer` (the spec) or `Stigmer.<field>...`
 * under it, by the fields' JSON names. Throws a sentence for a path the
 * definition does not have.
 */
export function resolveStigmerAnchor(anchor: string, def: StigmerDefinition): { node: SchemaNode; path: string } {
  const parts = anchor.split(".");
  if (parts[0] !== def.kind) throw new Error(`validate-as "${anchor}" does not name the ${def.kind} resource`);
  let node = def.spec;
  let path = "spec";
  for (const name of parts.slice(1)) {
    const next = node.properties?.[name];
    if (next === undefined || next.type !== "object") {
      throw new Error(`validate-as "${anchor}": ${path} has no object field "${name}"`);
    }
    node = next;
    path = `${path}.${name}`;
  }
  return { node, path };
}

/** The problems with a fragment shown under an anchor (`validate-as="Stigmer.ingress"`). */
export function validateStigmerFragment(doc: unknown, anchor: string, def: StigmerDefinition): string[] {
  const { node, path } = resolveStigmerAnchor(anchor, def);
  return validateNode(doc, node, path);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function validateNode(value: unknown, node: SchemaNode, path: string): string[] {
  if (node["x-kubernetes-preserve-unknown-fields"] === true) return [];
  if (node["x-kubernetes-int-or-string"] === true) {
    const t = typeOf(value);
    return t === "integer" || t === "string" ? [] : [`${path}: want an integer or a string, got ${t}`];
  }
  const t = typeOf(value);
  switch (node.type) {
    case "object":
      return validateObject(value, node, path, t);
    case "array": {
      if (t !== "array") return [`${path}: want a list, got ${t}`];
      const list = value as unknown[];
      const problems: string[] = [];
      if (node.maxItems !== undefined && list.length > node.maxItems) problems.push(`${path}: at most ${node.maxItems} entries, got ${list.length}`);
      if (node.items !== undefined) list.forEach((item, i) => problems.push(...validateNode(item, node.items as SchemaNode, `${path}[${i}]`)));
      return problems;
    }
    case "string": {
      if (t !== "string") return [`${path}: want a string, got ${t}`];
      return [...enumProblem(value, node, path), ...stringBounds(value as string, node, path)];
    }
    case "integer": {
      if (t !== "integer") return [`${path}: want an integer, got ${t}`];
      return [...enumProblem(value, node, path), ...numberBounds(value as number, node, path)];
    }
    case "number":
      return t === "integer" || t === "number" ? numberBounds(value as number, node, path) : [`${path}: want a number, got ${t}`];
    case "boolean":
      return t === "boolean" ? [] : [`${path}: want true or false, got ${t}`];
    default:
      return [];
  }
}

function validateObject(value: unknown, node: SchemaNode, path: string, t: string): string[] {
  if (t !== "object") return [`${path}: want a mapping, got ${t}`];
  const obj = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const name of node.required ?? []) {
    if (!(name in obj)) problems.push(`${path}.${name} is required`);
  }
  const props = node.properties;
  const extra = typeof node.additionalProperties === "object" ? node.additionalProperties : undefined;
  for (const [key, child] of Object.entries(obj)) {
    const sub = props?.[key] ?? extra;
    if (sub === undefined) {
      if (props !== undefined) {
        problems.push(`${path}: unknown field "${key}"${suggest(key, Object.keys(props))} (fields: ${Object.keys(props).sort().join(", ")})`);
      }
      continue;
    }
    problems.push(...validateNode(child, sub, `${path}.${key}`));
  }
  return problems;
}

function enumProblem(value: unknown, node: SchemaNode, path: string): string[] {
  if (node.enum === undefined || node.enum.includes(value)) return [];
  return [`${path}: ${JSON.stringify(value)} is not one of ${node.enum.map((e) => JSON.stringify(e)).join(", ")}`];
}

function stringBounds(value: string, node: SchemaNode, path: string): string[] {
  const problems: string[] = [];
  if (node.minLength !== undefined && value.length < node.minLength) problems.push(`${path}: at least ${node.minLength} characters`);
  if (node.maxLength !== undefined && value.length > node.maxLength) problems.push(`${path}: at most ${node.maxLength} characters`);
  if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) problems.push(`${path}: ${JSON.stringify(value)} does not match ${node.pattern}`);
  return problems;
}

function numberBounds(value: number, node: SchemaNode, path: string): string[] {
  const problems: string[] = [];
  if (node.minimum !== undefined && value < node.minimum) problems.push(`${path}: at least ${node.minimum}`);
  if (node.maximum !== undefined && value > node.maximum) problems.push(`${path}: at most ${node.maximum}`);
  return problems;
}

function suggest(key: string, known: string[]): string {
  const lower = key.toLowerCase();
  const close = known.find((k) => k.toLowerCase() === lower || k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return close === undefined ? "" : ` (did you mean "${close}"?)`;
}

// ============================================================================
// The reference page
// ============================================================================

/** Kubernetes core types the page names in one line, recognised by shape. */
const KUBERNETES_TYPES: { matches: (n: SchemaNode) => boolean; summary: string }[] = [
  {
    matches: (n) => n.type === "object" && hasFields(n, ["limits", "requests", "claims"]),
    summary:
      "Kubernetes [resource requirements](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): `requests` and `limits` of `cpu` and `memory`.",
  },
  {
    matches: (n) => n.type === "array" && n.items !== undefined && hasFields(n.items, ["name", "value", "valueFrom"]),
    summary:
      "A list of Kubernetes [environment variables](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/), each a `name` with a `value` or a `valueFrom`.",
  },
];

function hasFields(n: SchemaNode, names: string[]): boolean {
  return names.every((name) => n.properties?.[name] !== undefined);
}

function kubernetesType(n: SchemaNode): string | undefined {
  return KUBERNETES_TYPES.find((k) => k.matches(n))?.summary;
}

/**
 * Prose safe in MDX: a Go doc comment's lines joined, and braces and angle
 * brackets escaped outside inline code, which MDX shows as written. A bare
 * URL in a comment is an example address (http://minio.storage.svc:9000),
 * never a page to visit, so it is shown as code rather than linked.
 */
function prose(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => para.replace(/\s*\n\s*/g, " ").trim())
    .filter((para) => para !== "")
    .join("\n\n")
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith("`")
        ? part
        : part
            .replace(/\{/g, "\\{")
            .replace(/\}/g, "\\}")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/https?:\/\/[^\s)]*[^\s).,;:]/g, (url) => `\`${url}\``),
    )
    .join("");
}

/** A field's description, its leading Go name ("PullPolicy applies…") written as the field. */
function fieldProse(name: string, description: string | undefined): string {
  const text = prose(description ?? "");
  const first = /^(\w+)\b/.exec(text)?.[1];
  if (first !== undefined && first.toLowerCase() === name.toLowerCase()) return `\`${name}\`${text.slice(first.length)}`;
  return text;
}

function typeName(n: SchemaNode): string {
  if (n["x-kubernetes-int-or-string"] === true) return "integer or string";
  if (n.type === "array") return n.items === undefined ? "list" : `list of ${typeName(n.items)}`;
  if (n.type === "object" && typeof n.additionalProperties === "object") return `map of ${typeName(n.additionalProperties)}`;
  if (n.type === "object") return "object";
  return n.type ?? "any";
}

/** A rule's message as a sentence: the definition's are written without a full stop. */
function sentence(text: string): string {
  const t = prose(text).trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function bounds(n: SchemaNode): string | undefined {
  if (n.minimum !== undefined && n.maximum !== undefined) return `From ${n.minimum} to ${n.maximum}.`;
  if (n.minimum !== undefined) return `At least ${n.minimum}.`;
  if (n.maximum !== undefined) return `At most ${n.maximum}.`;
  return undefined;
}

function facts(n: SchemaNode, required: boolean): string[] {
  const out: string[] = [];
  if (required) out.push("Required.");
  if (n.default !== undefined) out.push(`Default: \`${JSON.stringify(n.default)}\`.`);
  if (n.enum !== undefined) out.push(`One of ${n.enum.map((e) => `\`${String(e)}\``).join(", ")}.`);
  const range = bounds(n);
  if (range !== undefined) out.push(range);
  if (n.maxItems !== undefined) out.push(`At most ${n.maxItems} entries.`);
  if (n.maxLength !== undefined) out.push(`At most ${n.maxLength} characters.`);
  for (const v of n["x-kubernetes-validations"] ?? []) {
    if (v.message !== undefined) out.push(`Rule: ${sentence(v.message)}`);
  }
  return out;
}

/** The section of one object: its own words, then each field, then its object fields' sections. */
function renderObject(node: SchemaNode, path: string, depth: number, out: string[]): void {
  const props = node.properties ?? {};
  const required = new Set(node.required ?? []);
  const nested: [string, SchemaNode][] = [];
  const lines: string[] = [];
  for (const name of Object.keys(props).sort()) {
    const child = props[name];
    const k8s = kubernetesType(child);
    const childPath = `${path}.${name}`;
    let what = `- **\`${name}\`** (${k8s === undefined ? typeName(child) : "Kubernetes type"})`;
    const words = fieldProse(name, child.description);
    if (k8s !== undefined) {
      what += `: ${words} ${k8s}`;
    } else if (child.type === "object" && child.properties !== undefined) {
      what += `: ${words} Its fields are under [\`${childPath}\`](#${anchorOf(childPath)}).`;
      nested.push([childPath, child]);
    } else if (child.type === "array" && child.items?.type === "object" && child.items.properties !== undefined) {
      what += `: ${words} Each entry's fields are under [\`${childPath}[]\`](#${anchorOf(`${childPath}[]`)}).`;
      nested.push([`${childPath}[]`, child.items]);
    } else {
      what += `: ${words}`;
    }
    const f = facts(child, required.has(name));
    if (f.length > 0) what += ` ${f.join(" ")}`;
    lines.push(what.trimEnd());
  }
  out.push(`${"#".repeat(Math.min(depth, 6))} \`${path}\``, "");
  const name = /([A-Za-z0-9]+)(\[\])?$/.exec(path)?.[1] ?? "";
  const own = path === "spec" ? "" : fieldProse(name, node.description);
  if (own !== "") out.push(own, "");
  const rules = (node["x-kubernetes-validations"] ?? []).filter((v) => v.message !== undefined);
  if (rules.length > 0 && path !== "spec") {
    out.push("Rules across these fields:", "", ...rules.map((v) => `- ${sentence(v.message ?? "")}`), "");
  }
  if (lines.length > 0) out.push(...lines, "");
  for (const [childPath, child] of nested) renderObject(child, childPath, depth + 1, out);
}

/**
 * What a printed column says: its own description, or that of the status
 * field its JSONPath reads.
 */
function columnWords(column: PrinterColumn, def: StigmerDefinition): string {
  if (column.description !== undefined) return prose(column.description);
  if (column.jsonPath === ".metadata.creationTimestamp") return "How long ago the resource was created.";
  // A filtered list (conditions[?(@.type=="Ready")]) is described by the
  // list's own words, which say what the entry it picks carries.
  const filtered = column.jsonPath.indexOf("[?(");
  const parts = (filtered === -1 ? column.jsonPath : column.jsonPath.slice(0, filtered)).split(".").filter((p) => p !== "");
  if (parts[0] !== "status") return "";
  let node: SchemaNode | undefined = def.status;
  for (const part of parts.slice(1)) {
    node = node?.properties?.[part] ?? node?.items?.properties?.[part];
  }
  return node === undefined ? "" : fieldProse(parts[parts.length - 1], node.description);
}

function anchorOf(path: string): string {
  return path.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The reference page for the resource, as MDX. */
export function renderStigmerReference(def: StigmerDefinition): string {
  const out: string[] = [
    "---",
    `title: The ${def.kind} resource`,
    "description:",
    `  Every field of the ${def.kind} resource the Kubernetes operator runs Stigmer from, with its type, default, allowed values and rules.`,
    "---",
    "",
    `{/* Auto-generated by gen-operator-docs from ${DEFINITION_REPO_PATH}. Do not edit manually. */}`,
    `{/* The words are the Go doc comments in deploy/operator/api/v1; edit them there and run make gen-operator-docs. */}`,
    "",
    `\`apiVersion: ${def.group}/${def.version}\`, \`kind: ${def.kind}\`, ${def.scope === "Namespaced" ? "namespaced" : "cluster-wide"}` +
      `${def.shortNames.length > 0 ? `, short name \`${def.shortNames.join("`, `")}\`` : ""}. ${prose(def.description)}`,
    "",
    "The [Kubernetes guide](/docs/guides/self-hosting/kubernetes) walks an install step by step; this page lists every field. The API server checks the types, allowed values and rules below when you apply the resource, and refuses a declaration that breaks one, naming the field.",
    "",
    "## Rules across fields",
    "",
    "Each is checked when the resource is applied:",
    "",
    ...(def.spec["x-kubernetes-validations"] ?? []).filter((v) => v.message !== undefined).map((v) => `- ${sentence(v.message ?? "")}`),
    "",
  ];
  renderObject(def.spec, "spec", 2, out);
  out.push(
    "## What `kubectl get stigmer` prints",
    "",
    "| Column | Field | What it says |",
    "| --- | --- | --- |",
    ...def.columns.map((c) => `| ${c.name} | \`${c.jsonPath.replace(/\|/g, "\\|")}\` | ${columnWords(c, def).replace(/\|/g, "\\|")} |`),
    "",
  );
  renderObject(def.status, "status", 2, out);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** Writes the reference page into `outputDir` as stigmer.mdx. */
export function writeStigmerReference(outputDir: string, path: string | URL = STIGMER_DEFINITION_PATH): string {
  const file = `${outputDir.replace(/\/$/, "")}/stigmer.mdx`;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(file, renderStigmerReference(loadStigmerDefinition(path)));
  return file;
}
