// The docs YAML gate (--target=docs-yaml-check): validates every ```yaml
// code fence under docs/ against the proto contract, applying the same
// strict decode posture the platform applies to user manifests. Byte-parity
// port of docs_yaml_gate.go; the four-class contract (manifest / task list
// / anchored fragment / no-validate) and the ratchet — no YAML shown to
// users can be silently unvalidated — are unchanged.
//
// Where Go resolved messages from protoregistry.GlobalTypes filled by blank
// stub imports, this port scans @stigmer/protos' descriptors
// (stigmer-registry.ts); manifest kinds come from the protovalidate
// string.const pinned on kind/api_version fields and variant types from the
// (apiresource.discriminator_value) message option — nothing hand-maintained.

import * as fs from "node:fs";
import * as path from "node:path";

import type { DescField, DescMessage, JsonValue, Message, Registry } from "@bufbuild/protobuf";
import { fromJson, getOption, hasOption, toJson } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import type { Struct } from "@bufbuild/protobuf/wkt";
import { discriminated_by, discriminator_value } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import { WorkflowTaskSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { field as validateFieldExt } from "@stigmer/protos/buf/validate/validate_pb";
import { parseAllDocuments } from "yaml";

import type { DocsYamlRuleEval, DocsYamlRuleMode } from "./docs-yaml-rules.js";
import { newDocsYamlRuleEval } from "./docs-yaml-rules.js";
import type { CodeFence } from "./mdx-fence-scanner.js";
import { scanMarkdownFences } from "./mdx-fence-scanner.js";
import { readDirSorted } from "./schema.js";
import { allStigmerMessages, stigmerRegistry } from "./stigmer-registry.js";

const NO_VALIDATE_PATTERN = /no-validate="([^"]*)"/;
const VALIDATE_AS_PATTERN = /validate-as="([^"]*)"/;

interface ManifestKindInfo {
  desc: DescMessage;
  apiVersion: string;
}

interface DocsYamlRegistries {
  manifestKinds: Map<string, ManifestKindInfo>;
  variantTypes: Map<string, DescMessage>;
  registry: Registry;
  rules: DocsYamlRuleEval | null;
}

// Duplicate discriminator values would make variant resolution ambiguous,
// so they fail construction.
function buildDocsYamlRegistries(): DocsYamlRegistries {
  const reg: DocsYamlRegistries = {
    manifestKinds: new Map(),
    variantTypes: new Map(),
    registry: stigmerRegistry(),
    rules: null,
  };

  for (const desc of allStigmerMessages()) {
    const dv = messageDiscriminatorValue(desc);
    if (dv !== "") {
      const existing = reg.variantTypes.get(dv);
      if (existing !== undefined) {
        throw new Error(
          `discriminator value "${dv}" is claimed by both ${existing.typeName} and ${desc.typeName}; variant resolution must become union-scoped`,
        );
      }
      reg.variantTypes.set(dv, desc);
    }

    const kindConst = fieldStringConst(desc.fields.find((f) => f.name === "kind"));
    const apiConst = fieldStringConst(desc.fields.find((f) => f.name === "api_version"));
    if (kindConst !== "" && apiConst !== "") {
      const existing = reg.manifestKinds.get(kindConst);
      if (existing !== undefined) {
        throw new Error(`manifest kind "${kindConst}" is claimed by both ${existing.desc.typeName} and ${desc.typeName}`);
      }
      reg.manifestKinds.set(kindConst, { desc, apiVersion: apiConst });
    }
  }

  if (reg.manifestKinds.size === 0 || reg.variantTypes.size === 0) {
    throw new Error(
      `descriptor scan found ${reg.manifestKinds.size} manifest kinds and ${reg.variantTypes.size} variant types; are the resource stub packages imported?`,
    );
  }
  return reg;
}

// The protovalidate (buf.validate.field).string.const pinned on fd, or "".
function fieldStringConst(fd: DescField | undefined): string {
  if (fd === undefined || fd.fieldKind !== "scalar" || fd.scalar !== 9 /* STRING */) return "";
  if (!hasOption(fd, validateFieldExt)) return "";
  const rules = getOption(fd, validateFieldExt);
  if (rules.type.case !== "string") return "";
  return rules.type.value.const ?? "";
}

function messageDiscriminatorValue(desc: DescMessage): string {
  if (!hasOption(desc, discriminator_value)) return "";
  return getOption(desc, discriminator_value);
}

function fieldDiscriminatedBy(fd: DescField): string {
  if (!hasOption(fd, discriminated_by)) return "";
  return getOption(fd, discriminated_by);
}

// ============================================================================
// Validation
// ============================================================================

function validateManifestDoc(doc: Record<string, unknown>, reg: DocsYamlRegistries): string[] {
  const kindStr = typeof doc.kind === "string" ? doc.kind : "";
  if (kindStr === "") {
    return ["manifest has apiVersion but no kind"];
  }
  const info = reg.manifestKinds.get(kindStr);
  if (info === undefined) {
    return [
      `unknown resource kind "${kindStr}"${didYouMean(kindStr, sortedKeys(reg.manifestKinds))} (known kinds: ${sortedKeys(reg.manifestKinds).join(", ")})`,
    ];
  }

  const problems: string[] = [];
  const apiV = typeof doc.apiVersion === "string" ? doc.apiVersion : "";
  if (apiV !== info.apiVersion) {
    problems.push(`${kindStr} manifest: apiVersion is "${apiV}", want "${info.apiVersion}"`);
  }

  let msg: Message;
  try {
    msg = fromJson(info.desc, doc as JsonValue, { registry: reg.registry });
  } catch (err) {
    problems.push(`${kindStr} manifest does not validate against ${info.desc.typeName}: ${errText(err)}`);
    return problems;
  }
  problems.push(...(reg.rules?.evaluate(info.desc, msg, kindStr) ?? []));
  problems.push(...validateDiscriminatedStructs(reflect(info.desc, msg), reg, kindStr));
  return problems;
}

function validateAuthoringTaskEntry(entry: Record<string, unknown>, reg: DocsYamlRegistries): string[] {
  let task;
  try {
    task = fromJson(WorkflowTaskSchema, entry as JsonValue, { registry: reg.registry });
  } catch (err) {
    return [`does not parse as an authoring-form task (name/kind/task_config): ${errText(err)}`];
  }
  if (task.name === "") {
    return ["task name is required"];
  }
  if (task.taskConfig === undefined) {
    return [`task "${task.name}": task_config is required`];
  }
  const at = `task "${task.name}"`;
  const problems = reg.rules?.evaluate(WorkflowTaskSchema, task, at) ?? [];
  problems.push(...validateDiscriminatedStructs(reflect(WorkflowTaskSchema, task), reg, at));
  return problems;
}

// Walks a decoded message tree; for every populated Struct field marked
// (apiresource.discriminated_by), resolves the typed variant from the
// sibling discriminator, strictly decodes the Struct contents into it, and
// recurses — so garbage inside task_config is caught at any nesting depth.
function validateDiscriminatedStructs(m: ReflectMessage, reg: DocsYamlRegistries, atPath: string): string[] {
  const problems: string[] = [];
  for (const fd of m.desc.fields) {
    if (!m.isSet(fd)) continue;
    const fieldPath = `${atPath}.${fd.name}`;

    if (isStructField(fd)) {
      const discBy = fieldDiscriminatedBy(fd);
      if (discBy !== "") {
        problems.push(...validateDiscriminatedStruct(m, fd, discBy, reg, fieldPath));
        continue;
      }
    }

    if (fd.fieldKind === "map") {
      if (fd.mapKind === "message") {
        const map = m.get(fd);
        for (const [k, mv] of map) {
          problems.push(...validateDiscriminatedStructs(mv as ReflectMessage, reg, `${fieldPath}[${String(k)}]`));
        }
      }
    } else if (fd.fieldKind === "list") {
      if (fd.listKind === "message") {
        const list = m.get(fd);
        for (let i = 0; i < list.size; i++) {
          problems.push(...validateDiscriminatedStructs(list.get(i) as ReflectMessage, reg, `${fieldPath}[${i}]`));
        }
      }
    } else if (fd.fieldKind === "message" && !isStructField(fd)) {
      problems.push(...validateDiscriminatedStructs(m.get(fd) as ReflectMessage, reg, fieldPath));
    }
  }
  return problems;
}

function validateDiscriminatedStruct(
  m: ReflectMessage,
  fd: DescField,
  discBy: string,
  reg: DocsYamlRegistries,
  atPath: string,
): string[] {
  const discFd = m.desc.fields.find((f) => f.name === discBy);
  if (discFd === undefined) {
    return [`${atPath}: contract bug — discriminated_by names field "${discBy}" which does not exist on ${m.desc.typeName}`];
  }

  let discValue = "";
  if (discFd.fieldKind === "enum") {
    const num = m.get(discFd) as number;
    const enumVal = discFd.enum.values.find((v) => v.number === num);
    if (enumVal !== undefined) discValue = enumVal.name;
  } else if (discFd.fieldKind === "scalar" && discFd.scalar === 9 /* STRING */) {
    discValue = m.get(discFd) as string;
  }

  const variant = reg.variantTypes.get(discValue);
  if (variant === undefined) {
    return [
      `${atPath}: no typed variant registered for ${discBy} "${discValue}"${didYouMean(discValue, sortedVariantKinds(reg))} (is the task's kind set correctly?)`,
    ];
  }

  const structMsg = (m.get(fd) as ReflectMessage).message as Struct;
  const cfgJson = toJson(StructSchema, structMsg);
  let msg: Message;
  try {
    msg = fromJson(variant, cfgJson, { registry: reg.registry });
  } catch (err) {
    return [`${atPath} is not a valid ${variant.typeName}: ${errText(err)}`];
  }
  // Rule evaluation at THIS decode point is the NESTED (latent) class: the
  // platform's own validation stops at the Struct envelope (#305 ruling).
  const problems = reg.rules?.evaluateNested(variant, msg, atPath) ?? [];
  problems.push(...validateDiscriminatedStructs(reflect(variant, msg), reg, atPath));
  return problems;
}

function isStructField(fd: DescField): boolean {
  return fd.fieldKind === "message" && fd.message.typeName === "google.protobuf.Struct";
}

// Turns a validate-as anchor into the message type a fragment must
// partially conform to: <Kind>[.<field>...], task[.<field>...], or
// task-config:<kind>.
function resolveAnchor(anchor: string, reg: DocsYamlRegistries): DescMessage {
  if (anchor.startsWith("task-config:")) {
    const kind = anchor.slice("task-config:".length);
    const mt = reg.variantTypes.get(kind);
    if (mt === undefined) {
      throw new Error(
        `validate-as "${anchor}": unknown task kind "${kind}"${didYouMean(kind, sortedVariantKinds(reg))} (valid kinds: ${sortedVariantKinds(reg).join(", ")})`,
      );
    }
    return mt;
  }

  const parts = anchor.split(".");
  let mt: DescMessage;
  if (parts[0] === "task") {
    mt = WorkflowTaskSchema;
  } else {
    const info = reg.manifestKinds.get(parts[0]);
    if (info === undefined) {
      throw new Error(
        `validate-as "${anchor}": unknown resource kind "${parts[0]}"${didYouMean(parts[0], sortedKeys(reg.manifestKinds))} (known kinds: ${sortedKeys(reg.manifestKinds).join(", ")})`,
      );
    }
    mt = info.desc;
  }

  for (const fieldName of parts.slice(1)) {
    const fd = mt.fields.find((f) => f.name === fieldName);
    if (fd === undefined || fd.fieldKind !== "message") {
      throw new Error(`validate-as "${anchor}": ${mt.typeName} has no singular message field "${fieldName}"`);
    }
    mt = fd.message;
  }
  return mt;
}

function validateAnchoredDoc(doc: unknown, anchorType: DescMessage, anchor: string, reg: DocsYamlRegistries): string[] {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return [`validate-as "${anchor}" expects mapping documents, got ${yamlTypeName(doc)}`];
  }
  let msg: Message;
  try {
    msg = fromJson(anchorType, doc as JsonValue, { registry: reg.registry });
  } catch (err) {
    return [`fragment does not validate against ${anchorType.typeName} (anchor "${anchor}"): ${errText(err)}`];
  }
  return validateDiscriminatedStructs(reflect(anchorType, msg), reg, anchor);
}

function yamlTypeName(doc: unknown): string {
  if (Array.isArray(doc)) return "[]interface {}";
  return typeof doc;
}

// ============================================================================
// Classification
// ============================================================================

type BlockClass = "manifest" | "task-list" | "anchored" | "skipped" | "invalid";

function classifyAndValidateFence(f: CodeFence, reg: DocsYamlRegistries): [BlockClass, string[]] {
  reg.rules?.beginFence(f.path, f.line);

  const hasNoValidate = f.meta.includes("no-validate");
  const hasValidateAs = f.meta.includes("validate-as");
  if (hasNoValidate && hasValidateAs) {
    return ["invalid", ["a fence cannot carry both no-validate and validate-as"]];
  }

  if (hasNoValidate) {
    const match = NO_VALIDATE_PATTERN.exec(f.meta);
    if (match === null || match[1].trim() === "") {
      return ["invalid", ['no-validate marker requires a reason: use no-validate="why this block cannot be validated"']];
    }
    return ["skipped", []];
  }

  if (hasValidateAs) {
    const match = VALIDATE_AS_PATTERN.exec(f.meta);
    if (match === null || match[1].trim() === "") {
      return ["invalid", ['validate-as marker requires an anchor: use validate-as="<Kind>[.<field>]", validate-as="task", or validate-as="task-config:<kind>"']];
    }
    const anchor = match[1].trim();
    let anchorType: DescMessage;
    try {
      anchorType = resolveAnchor(anchor, reg);
    } catch (err) {
      return ["invalid", [errText(err)]];
    }
    let docs: unknown[];
    try {
      docs = decodeYamlDocuments(f.body);
    } catch (err) {
      return ["invalid", [`invalid YAML: ${errText(err)}`]];
    }
    if (docs.length === 0) {
      return ["invalid", ["empty yaml block"]];
    }
    const problems: string[] = [];
    for (const doc of docs) {
      problems.push(...validateAnchoredDoc(doc, anchorType, anchor, reg));
    }
    if (problems.length > 0) return ["invalid", problems];
    return ["anchored", []];
  }

  let docs: unknown[];
  try {
    docs = decodeYamlDocuments(f.body);
  } catch (err) {
    return ["invalid", [`invalid YAML: ${errText(err)}`]];
  }
  if (docs.length === 0) {
    return ["invalid", ["empty yaml block"]];
  }

  let cls: BlockClass = "invalid";
  const problems: string[] = [];
  for (const doc of docs) {
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) {
      const d = doc as Record<string, unknown>;
      if ("apiVersion" in d) {
        if (cls === "invalid") cls = "manifest";
        reg.rules?.setBlockClass("manifest");
        problems.push(...validateManifestDoc(d, reg));
        continue;
      }
      problems.push(unclassifiedBlockProblem());
    } else if (Array.isArray(doc)) {
      reg.rules?.setBlockClass("task list");
      const [taskProblems, isTaskList] = validateTaskListDoc(doc, reg);
      if (isTaskList) {
        if (cls === "invalid") cls = "task-list";
        problems.push(...taskProblems);
        continue;
      }
      problems.push(...taskProblems);
    } else {
      problems.push(unclassifiedBlockProblem());
    }
  }
  if (problems.length > 0) return ["invalid", problems];
  return [cls, []];
}

function validateTaskListDoc(entries: unknown[], reg: DocsYamlRegistries): [string[], boolean] {
  if (entries.length === 0) {
    return [["empty yaml block"], false];
  }

  const maps: Array<Record<string, unknown>> = [];
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      return [[unclassifiedBlockProblem()], false];
    }
    maps.push(e as Record<string, unknown>);
  }

  let looksLikeTasks = false;
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    const kind = typeof m.kind === "string" ? m.kind : "";
    const hasName = "name" in m;
    if (kind === "" && !hasName) {
      return [[unclassifiedBlockProblem()], false];
    }
    looksLikeTasks = true;
    if (!reg.variantTypes.has(kind)) {
      return [
        [
          `task entry ${i + 1}: unknown task kind "${kind}"${didYouMean(kind, sortedVariantKinds(reg))} (valid kinds: ${sortedVariantKinds(reg).join(", ")})`,
        ],
        false,
      ];
    }
  }
  if (!looksLikeTasks) {
    return [[unclassifiedBlockProblem()], false];
  }

  const problems: string[] = [];
  for (let i = 0; i < maps.length; i++) {
    for (const p of validateAuthoringTaskEntry(maps[i], reg)) {
      problems.push(maps.length === 1 ? p : `task entry ${i + 1}: ${p}`);
    }
  }
  return [problems, true];
}

function unclassifiedBlockProblem(): string {
  return (
    "unclassified yaml block: not a resource manifest (apiVersion/kind) and not an authoring-form task list; " +
    'anchor it with validate-as="<Kind>[.<field>]" (or "task" / "task-config:<kind>") if it is a contract fragment, ' +
    'or mark it no-validate="reason" if it is not resource YAML at all'
  );
}

function decodeYamlDocuments(body: string): unknown[] {
  const parsed = parseAllDocuments(body);
  const docs: unknown[] = [];
  for (const d of parsed) {
    if (d.errors.length > 0) {
      throw new Error(d.errors[0].message);
    }
    const value: unknown = d.toJS();
    if (value !== null && value !== undefined) {
      docs.push(value);
    }
  }
  return docs;
}

// ============================================================================
// Tree walk and reporting
// ============================================================================

// The dead `$context.env` expression namespace is a hard failure on
// authoring surfaces (stigmer/stigmer#778 finding 3).
const DEAD_EXPRESSION_NAMESPACE = /\$context\.env/;

interface DocsYamlProblem {
  path: string;
  line: number;
  msg: string;
}

function checkDeadExpressionNamespace(filePath: string, src: string): DocsYamlProblem[] {
  const problems: DocsYamlProblem[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (DEAD_EXPRESSION_NAMESPACE.test(lines[i])) {
      problems.push({
        path: filePath,
        line: i + 1,
        msg:
          "references the dead '$context.env' expression namespace, which resolves to null at runtime — " +
          "environment variables are accessed via '$env.<VAR>' ($context holds accumulated task outputs)",
      });
    }
  }
  return problems;
}

interface AuthoringDirsSummary {
  files: number;
  manifests: number;
}

// Raw authoring surfaces (examples/, seedpack/): every YAML document with
// an apiVersion is validated as a full manifest; every file is scanned for
// the dead namespace.
function checkAuthoringDirs(dirs: string[], reg: DocsYamlRegistries): [AuthoringDirsSummary, DocsYamlProblem[]] {
  const summary: AuthoringDirsSummary = { files: 0, manifests: 0 };
  const problems: DocsYamlProblem[] = [];

  for (const dir of dirs) {
    for (const filePath of walkFilesLexical(dir)) {
      const ext = path.extname(filePath);
      const isYaml = ext === ".yaml" || ext === ".yml";
      const isMarkdown = ext === ".md" || ext === ".mdx";
      if (!isYaml && !isMarkdown) continue;

      const src = fs.readFileSync(filePath, "utf8");
      summary.files++;
      problems.push(...checkDeadExpressionNamespace(filePath, src));
      if (!isYaml) continue;

      let docs: unknown[];
      try {
        docs = decodeYamlDocuments(src);
      } catch (err) {
        problems.push({ path: filePath, line: 0, msg: `invalid YAML: ${errText(err)}` });
        continue;
      }
      for (const doc of docs) {
        if (typeof doc !== "object" || doc === null || Array.isArray(doc)) continue;
        const mapping = doc as Record<string, unknown>;
        if (!("apiVersion" in mapping)) continue;
        summary.manifests++;
        reg.rules?.beginFence(filePath, 0);
        reg.rules?.setBlockClass("manifest");
        for (const msg of validateManifestDoc(mapping, reg)) {
          problems.push({ path: filePath, line: 0, msg });
        }
      }
    }
  }
  return [summary, problems];
}

interface DocsYamlSummary {
  files: number;
  blocks: number;
  manifests: number;
  taskLists: number;
  anchored: number;
  skipped: number;
}

function* walkFilesLexical(root: string, skipDirName?: string): Generator<string> {
  for (const entry of readDirSorted(root)) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (skipDirName !== undefined && entry.name === skipDirName) continue;
      yield* walkFilesLexical(child, skipDirName);
    } else {
      yield child;
    }
  }
}

function checkDocsYaml(docsDir: string, ruleMode: DocsYamlRuleMode): [DocsYamlSummary, DocsYamlProblem[], DocsYamlRuleEval | null] {
  const reg = buildDocsYamlRegistries();
  reg.rules = newDocsYamlRuleEval(ruleMode);

  const summary: DocsYamlSummary = { files: 0, blocks: 0, manifests: 0, taskLists: 0, anchored: 0, skipped: 0 };
  const problems: DocsYamlProblem[] = [];

  for (const filePath of walkFilesLexical(docsDir, "_archive")) {
    const ext = path.extname(filePath);
    if (ext !== ".md" && ext !== ".mdx") continue;

    const src = fs.readFileSync(filePath, "utf8");
    problems.push(...checkDeadExpressionNamespace(filePath, src));
    let fences: CodeFence[];
    try {
      fences = scanMarkdownFences(filePath, src);
    } catch (err) {
      problems.push({ path: filePath, line: 0, msg: errText(err) });
      continue;
    }

    let fileHasYaml = false;
    for (const f of fences) {
      if (f.lang !== "yaml" && f.lang !== "yml") continue;
      fileHasYaml = true;
      summary.blocks++;
      const [cls, blockProblems] = classifyAndValidateFence(f, reg);
      if (cls === "manifest") summary.manifests++;
      else if (cls === "task-list") summary.taskLists++;
      else if (cls === "anchored") summary.anchored++;
      else if (cls === "skipped") summary.skipped++;
      for (const msg of blockProblems) {
        problems.push({ path: f.path, line: f.line, msg });
      }
    }
    if (fileHasYaml) summary.files++;
  }

  problems.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.line - b.line;
  });
  return [summary, problems, reg.rules];
}

/** The --target=docs-yaml-check entry point. */
export function runDocsYamlCheck(docsDir: string, authoringDirs: string[], ruleMode: DocsYamlRuleMode): void {
  const [summary, problems, rules] = checkDocsYaml(docsDir, ruleMode);

  let authoringSummary: AuthoringDirsSummary = { files: 0, manifests: 0 };
  if (authoringDirs.length > 0) {
    const reg = buildDocsYamlRegistries();
    reg.rules = rules;
    const [aSummary, aProblems] = checkAuthoringDirs(authoringDirs, reg);
    authoringSummary = aSummary;
    problems.push(...aProblems);
  }

  // The report precedes the gate result: report-mode findings print whether
  // or not decode problems fail the build below.
  rules?.printRuleReport();

  if (problems.length > 0) {
    process.stdout.write(`docs YAML gate found ${problems.length} problem(s):\n\n`);
    let lastHintedPath = "";
    for (const p of problems) {
      if (p.line > 0) {
        process.stdout.write(`  ${p.path}:${p.line}\n    ${p.msg}\n`);
      } else {
        process.stdout.write(`  ${p.path}\n    ${p.msg}\n`);
      }
      const hint = generatedDocHint(docsDir, p.path);
      if (hint !== "" && p.path !== lastHintedPath) {
        process.stdout.write(`    note: ${hint}\n`);
        lastHintedPath = p.path;
      }
    }
    process.stdout.write(
      "\nEvery ```yaml block in docs must be a resource manifest (apiVersion/kind),\n" +
        "an authoring-form task list (- name/kind/task_config), an anchored fragment\n" +
        '(validate-as="<Kind>[.<field>]" / "task" / "task-config:<kind>"), or carry an\n' +
        'explicit no-validate="reason" marker in the fence info string.\n',
    );
    throw new Error(`docs YAML validation failed with ${problems.length} problem(s)`);
  }

  process.stdout.write(
    `✓ docs YAML gate: ${summary.blocks} blocks across ${summary.files} files — ${summary.manifests} manifests, ${summary.taskLists} task lists, ${summary.anchored} anchored fragments, ${summary.skipped} skipped with no-validate, 0 unclassified\n`,
  );
  if (authoringDirs.length > 0) {
    process.stdout.write(
      `✓ authoring surfaces (${authoringDirs.join(", ")}): ${authoringSummary.files} files scanned, ${authoringSummary.manifests} raw manifests validated, namespace check clean\n`,
    );
  }
}

// Maps generator-owned docs paths to the source that must be edited instead.
function generatedDocHint(docsDir: string, p: string): string {
  let rel: string;
  try {
    rel = path.relative(docsDir, p);
  } catch {
    return "";
  }
  rel = rel.split(path.sep).join("/");
  if (rel.startsWith("sdk/resources/")) {
    return "this page is generated — fix the example in the resource's apis/**/docs/overview.md, then run 'make gen-proto-sdk-docs'";
  }
  if (rel.startsWith("guides/workflows/task-types/")) {
    return "this page is generated — fix apis/ai/stigmer/agentic/workflow/v1/tasks/meta/<kind>.yaml (or the index enrichment template), then run 'make gen-task-docs'";
  }
  if (rel.startsWith("cli/commands/")) {
    return "this page is generated — fix the CLI source, then run 'make gen-cli-docs'";
  }
  if (rel.startsWith("sdk/react/") || rel.startsWith("sdk/ink/reference") || rel.startsWith("sdk/theme/tokens") || rel.startsWith("sdk/theme/presets")) {
    return "this page is generated — fix the generator input, not this file (see 'make gen-sdk-docs')";
  }
  return "";
}

// ============================================================================
// Small helpers
// ============================================================================

function sortedKeys(m: Map<string, ManifestKindInfo>): string[] {
  return [...m.keys()].sort();
}

function sortedVariantKinds(reg: DocsYamlRegistries): string[] {
  return [...reg.variantTypes.keys()].sort();
}

function didYouMean(input: string, candidates: string[]): string {
  if (input === "") return "";
  let best = "";
  let bestDist = 3; // suggest only within edit distance 2
  for (const c of candidates) {
    const d = editDistance(input, c);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  if (best === "") return "";
  return ` (did you mean "${best}"?)`;
}

function editDistance(a: string, b: string): number {
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
